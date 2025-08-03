import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import businessRoutes from "./routes/businessRoutes.js";
import instagramRoutes from "./routes/instagramRoute.js";
import facebookRoutes from "./routes/facebookRoute.js";
import webSocketRoutes from "./routes/webSocketRoutes.js";
import whatsappRoutes from "./routes/whatsappRoute.js";
import { pollingService } from "./services/pollingService.js";
import { webChatSocketService } from "./services/webChatSocketService.js";
import dbChangeMonitor from "./services/dbChangeMonitor.js";
import requestTracker from "./middleware/requestTracker.js";
import { logger } from "./utils/logger.js";


dotenv.config();
const app = express();

// Middleware
// app.use(cors({
//   origin: ["http://localhost:5001", "http://127.0.0.1:5001"],
//   credentials: true
// }));
// app.use(helmet({
//   contentSecurityPolicy: {
//     directives: {
//       defaultSrc: ["'self'"],
//       scriptSrc: ["'self'"],
//       styleSrc: ["'self'", "'unsafe-inline'"],
//       connec tSrc: ["'self'", "ws://localhost:5001", "wss://localhost:5001", "http://localhost:5001", "https://genistud.io"]
//     }
//   }
// }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request tracking middleware (must be before routes)
app.use(requestTracker.trackRequest());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Middleware API is running',
    timestamp: new Date().toISOString()
  });
});

// Test endpoint for graceful shutdown testing
app.get('/test-long-request', async (req, res) => {
  const duration = parseInt(req.query.duration) || 3000;
  logger.info(`Starting long request test - duration: ${duration}ms`);
  
  await new Promise(resolve => setTimeout(resolve, duration));
  
  res.json({
    status: 'completed',
    message: `Request completed after ${duration}ms`,
    timestamp: new Date().toISOString()
  });
  
  logger.info(`Long request test completed - duration: ${duration}ms`);
});

// Routes
app.use("/business", businessRoutes);
app.use("/instagram", instagramRoutes);
app.use("/facebook", facebookRoutes);
app.use("/api/webchat", webSocketRoutes);
app.use("/whatsapp", whatsappRoutes);

// Global error handler
app.use((err, req, res, _next) => {
  logger.logError(err, { context: "Unhandled error" });
  res.status(500).json({ error: "Internal Server Error" });
});

// Create HTTP server
const server = http.createServer(app);

// Export server instance and request tracker for graceful shutdown
export { server, requestTracker };

// Initialize WebSocket service
webChatSocketService.initialize(server);

// Start server
const PORT = process.env.PORT || 5001;
server.listen(PORT, async () => {
  logger.info(`Middleware API running on port: ${PORT}`);
  logger.info(`WebSocket available at ws://localhost:${PORT}/api/webchat/ws`);
  logger.info(`Chatbot Testing Interface available at http://localhost:${PORT}`);

  try {
    await pollingService.startAllPolling();
    logger.info("Polling service started");
  } catch (err) {
    logger.logError(err, { context: "Failed to start polling service" });
  }

  try {
    await dbChangeMonitor.start();
    logger.info("Database change monitor started successfully");
  } catch (err) {
    logger.error("Failed to start database change monitor", { 
      error: err.message,
      code: err.code 
    });
    logger.warn("Server will continue running without database change monitoring");
    logger.info("Database change monitoring will be retried automatically when database becomes available");
  }
});

// Graceful shutdown handling
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  
  dbChangeMonitor.stop();
  
  // Stop accepting new connections
  server.close(async () => {
    logger.info('Server stopped accepting new connections');
    
    // Wait for active requests to complete
    await requestTracker.waitForAllRequests(10000);
    
    logger.info('Server closed gracefully');
    process.exit(0);
  });
  
  // Force exit after timeout
  setTimeout(() => {
    logger.warn('Graceful shutdown timeout - forcing exit');
    process.exit(1);
  }, 15000);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  
  dbChangeMonitor.stop();
  
  // Stop accepting new connections
  server.close(async () => {
    logger.info('Server stopped accepting new connections');
    
    // Wait for active requests to complete
    await requestTracker.waitForAllRequests(10000);
    
    logger.info('Server closed gracefully');
    process.exit(0);
  });
  
  // Force exit after timeout
  setTimeout(() => {
    logger.warn('Graceful shutdown timeout - forcing exit');
    process.exit(1);
  }, 15000);
});
