import prisma from "../config/db.js";
import { logger } from "../utils/logger.js";
import fs from 'fs';
import path from 'path';

class DatabaseChangeMonitor {
  constructor() {
    this.isMonitoring = false;
    this.checkInterval = null;
    this.lastBusinessCount = 0;
    this.lastBusinessIds = new Set();
    this.lastBusinessData = new Map();
    this.monitoringInterval = parseInt(process.env.DB_MONITOR_INTERVAL) || 5000; // Default 5 seconds
  }

  async start() {
    if (this.isMonitoring) {
      return;
    }

    try {
      // Test database connection first
      await this.testDatabaseConnection();
      
      // Get initial state with key fields that might affect webhook functionality
      const businesses = await prisma.business.findMany({
        select: { 
          id: true,
          facebookVerifyToken: true,
          whatsappVerifyToken: true,
          recipientId: true,
          channelId: true
        }
      });
      
      this.lastBusinessCount = businesses.length;
      this.lastBusinessIds = new Set(businesses.map(b => b.id));
      this.lastBusinessData = new Map(businesses.map(b => [b.id, {
        facebookVerifyToken: b.facebookVerifyToken,
        whatsappVerifyToken: b.whatsappVerifyToken,
        recipientId: b.recipientId,
        channelId: b.channelId
      }]));
      this.isMonitoring = true;

      logger.info("Database change monitor started", {
        initialBusinessCount: this.lastBusinessCount,
        monitoringInterval: this.monitoringInterval
      });

      // Check for changes at specified interval
      this.checkInterval = setInterval(() => {
        this.checkForChanges();
      }, this.monitoringInterval);

    } catch (error) {
      logger.error("Failed to start database change monitor", {
        error: error.message,
        code: error.code
      });
      
      // If database is not reachable, don't start monitoring
      if (this.isDatabaseConnectionError(error)) {
        logger.warn("Database connection failed - database change monitor will not start");
        logger.info("The server will continue running without database change monitoring");
        return;
      }
      
      throw error;
    }
  }

  async checkForChanges() {
    try {
      const businesses = await prisma.business.findMany({
        select: { 
          id: true,
          facebookVerifyToken: true,
          whatsappVerifyToken: true,
          recipientId: true,
          channelId: true
        }
      });

      const currentBusinessCount = businesses.length;
      const currentBusinessIds = new Set(businesses.map(b => b.id));
      const currentBusinessData = new Map(businesses.map(b => [b.id, {
        facebookVerifyToken: b.facebookVerifyToken,
        whatsappVerifyToken: b.whatsappVerifyToken,
        recipientId: b.recipientId,
        channelId: b.channelId
      }]));

      // Check if businesses were deleted
      const deletedBusinesses = [...this.lastBusinessIds].filter(id => 
        !currentBusinessIds.has(id)
      );

      // Check for critical field changes in existing businesses
      const criticalChanges = [];
      for (const [id, currentData] of currentBusinessData) {
        const lastData = this.lastBusinessData.get(id);
        if (lastData) {
          const changes = [];
          if (lastData.facebookVerifyToken !== currentData.facebookVerifyToken) {
            changes.push('facebookVerifyToken');
          }
          if (lastData.whatsappVerifyToken !== currentData.whatsappVerifyToken) {
            changes.push('whatsappVerifyToken');
          }
          if (lastData.recipientId !== currentData.recipientId) {
            changes.push('recipientId');
          }
          if (lastData.channelId !== currentData.channelId) {
            changes.push('channelId');
          }
          
          if (changes.length > 0) {
            criticalChanges.push({ businessId: id, fields: changes });
          }
        }
      }

      // Trigger refresh if businesses were deleted or critical fields changed
      if (currentBusinessCount < this.lastBusinessCount || 
          deletedBusinesses.length > 0 || 
          criticalChanges.length > 0) {
        
        logger.warn("Critical database changes detected - triggering server refresh", {
          previousCount: this.lastBusinessCount,
          currentCount: currentBusinessCount,
          deletedBusinessIds: deletedBusinesses,
          criticalChanges: criticalChanges
        });

        this.triggerServerRefresh();
      }

      // Update tracking data
      this.lastBusinessCount = currentBusinessCount;
      this.lastBusinessIds = currentBusinessIds;
      this.lastBusinessData = currentBusinessData;

    } catch (error) {
      logger.error("Error checking for database changes", {
        error: error.message,
        code: error.code
      });
      
      // If this is a database connection error, stop monitoring temporarily
      if (this.isDatabaseConnectionError(error)) {
        logger.warn("Database connection lost - stopping change monitor temporarily");
        this.stop();
        
        // Try to reconnect after a delay
        setTimeout(() => {
          logger.info("Attempting to restart database change monitor...");
          this.start();
        }, 30000); // Wait 30 seconds before trying to restart
      }
    }
  }

  triggerServerRefresh() {
    logger.info("Triggering server refresh due to database changes...");
    
    // Clear any intervals
    this.stop();

    // Import the server instance to gracefully close it
    this.gracefulShutdown();
  }

  async gracefulShutdown() {
    logger.info("Starting graceful shutdown - waiting for active requests to complete...");
    
    try {
      // Import the server instance and request tracker
      const serverModule = await import('../server.js');
      const { server, requestTracker } = serverModule;
      
      if (server && requestTracker) {
        logger.info("Server and request tracker found - proceeding with graceful shutdown", {
          activeRequests: requestTracker.getActiveRequestCount()
        });
        
        // Stop accepting new connections
        server.close(async () => {
          logger.info("Server stopped accepting new connections");
          
          // Wait for existing requests to finish using the request tracker
          await requestTracker.waitForAllRequests(10000); // 10 second timeout
          
          // Close database connections
          await prisma.$disconnect();
          logger.info("Database connections closed gracefully");
          
          // Now restart based on environment
          this.performRestart();
        });
        
        // Set a timeout for forceful shutdown if server.close() doesn't work
        setTimeout(() => {
          logger.warn("Graceful shutdown timeout reached - forcing restart");
          this.performRestart();
        }, 5000); // Reduced to 5 seconds total timeout
        
      } else {
        logger.warn("Server instance or request tracker not available - performing immediate restart");
        this.performRestart();
      }
      
    } catch (error) {
      logger.error("Error during graceful shutdown", { error: error.message });
      this.performRestart();
    }
  }

  async waitForActiveConnections() {
    // This method is now replaced by the request tracker
    return Promise.resolve();
  }

  performRestart() {
    // For development with nodemon
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV !== 'production') {
      logger.info("Development mode detected - triggering nodemon restart");
      
      // Try multiple restart methods in sequence with shorter timeouts
      this.tryRestartMethods();
      
    } else {
      logger.info("Production mode - triggering process restart");
      process.exit(0);
    }
  }

  async tryRestartMethods() {
    let restartTriggered = false;

    // Method 1: IPC message (fastest - 1 second timeout)
    if (process.send && !restartTriggered) {
      try {
        process.send('rs');
        logger.info("Restart signal sent to nodemon via IPC");
        
        // Short timeout for IPC
        await new Promise((resolve) => {
          setTimeout(() => {
            if (!restartTriggered) {
              logger.warn("IPC restart timeout - trying file method");
              resolve();
            }
          }, 1000);
        });
        
      } catch (error) {
        logger.warn("Failed to send IPC restart signal", { error: error.message });
      }
    }

    // Method 2: File change trigger (if IPC didn't work)
    if (!restartTriggered) {
      logger.info("Trying file change method");
      this.triggerNodemonRestart();
      
      // Wait for file method
      await new Promise((resolve) => {
        setTimeout(() => {
          if (!restartTriggered) {
            logger.warn("File restart timeout - forcing exit");
            resolve();
          }
        }, 2000);
      });
    }

    // Method 3: Force exit (final fallback)
    if (!restartTriggered) {
      logger.info("All restart methods failed - forcing process exit");
      process.exit(0);
    }
  }

  triggerNodemonRestart() {
    try {
      const timestamp = new Date().toISOString();
      
      // Method 1: Create/modify the main trigger file
      const triggerFile = path.join(process.cwd(), '.nodemon-trigger');
      const triggerContent = `// Auto-restart trigger: ${timestamp}\n// Database change detected\n// PID: ${process.pid}\n`;
      
      logger.info("Creating nodemon trigger file", { 
        triggerFile,
        timestamp,
        workingDirectory: process.cwd()
      });
      
      fs.writeFileSync(triggerFile, triggerContent, { encoding: 'utf8' });
      
      // Method 2: Also modify an existing file in src/ (more reliable)
      const signalFile = path.join(process.cwd(), 'src', 'services', 'restart-signal.js');
      const signalContent = `// This file is used to trigger nodemon restarts when database changes occur
// Last restart: ${timestamp}
export const lastRestart = "${timestamp}";
export const processId = ${process.pid};
`;
      
      fs.writeFileSync(signalFile, signalContent, { encoding: 'utf8' });
      
      logger.info("Nodemon restart triggered via multiple file changes", { 
        mainTrigger: triggerFile,
        signalFile: signalFile,
        timestamp 
      });
      
      // Clean up files after restart (longer delay)
      setTimeout(() => {
        try {
          if (fs.existsSync(triggerFile)) {
            fs.unlinkSync(triggerFile);
            logger.debug("Main trigger file cleaned up");
          }
          
          // Reset the signal file to default state
          const defaultContent = `// This file is used to trigger nodemon restarts when database changes occur
// It gets modified and then deleted automatically
export const lastRestart = null;`;
          fs.writeFileSync(signalFile, defaultContent, { encoding: 'utf8' });
          logger.debug("Signal file reset to default");
          
        } catch (cleanupError) {
          logger.warn("Could not clean up trigger files", { error: cleanupError.message });
        }
      }, 8000); // Longer cleanup delay
      
    } catch (error) {
      logger.error("Failed to trigger nodemon restart via file changes", {
        error: error.message,
        stack: error.stack,
        workingDirectory: process.cwd()
      });
      
      // Final fallback - immediate exit
      logger.info("All file methods failed - forcing immediate exit");
      setTimeout(() => {
        process.exit(0);
      }, 500);
    }
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isMonitoring = false;
    logger.info("Database change monitor stopped");
  }

  async testDatabaseConnection() {
    try {
      // Simple query to test database connectivity
      await prisma.$queryRaw`SELECT 1`;
      logger.info("Database connection test successful");
      return true;
    } catch (error) {
      logger.error("Database connection test failed", {
        error: error.message,
        code: error.code
      });
      throw error;
    }
  }

  isDatabaseConnectionError(error) {
    // Check for common database connection error codes and messages
    const connectionErrorCodes = [
      'ECONNREFUSED',
      'ENOTFOUND',
      'ETIMEDOUT',
      'ECONNRESET',
      'P1001', // Prisma: Can't reach database server
      'P1008', // Prisma: Operations timed out
      'P1017'  // Prisma: Server has closed the connection
    ];

    const connectionErrorMessages = [
      'connection refused',
      'connection timeout',
      'server has closed the connection',
      'can\'t reach database server',
      'database server is not reachable',
      'connection terminated',
      'connection lost'
    ];

    if (error.code && connectionErrorCodes.includes(error.code)) {
      return true;
    }

    if (error.message) {
      const message = error.message.toLowerCase();
      return connectionErrorMessages.some(errorMsg => message.includes(errorMsg));
    }

    return false;
  }
}

// Create singleton instance
const dbChangeMonitor = new DatabaseChangeMonitor();

export default dbChangeMonitor;
