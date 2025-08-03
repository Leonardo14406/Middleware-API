import { logger } from "../utils/logger.js";

class RequestTracker {
  constructor() {
    this.activeRequests = new Set();
    this.requestCounter = 0;
  }

  // Middleware to track requests
  trackRequest() {
    return (req, res, next) => {
      const requestId = ++this.requestCounter;
      this.activeRequests.add(requestId);
      
      logger.debug("Request started", { 
        requestId, 
        method: req.method, 
        url: req.url,
        activeCount: this.activeRequests.size 
      });

      // Track when request ends
      const originalEnd = res.end;
      res.end = (...args) => {
        this.activeRequests.delete(requestId);
        logger.debug("Request completed", { 
          requestId, 
          method: req.method, 
          url: req.url,
          activeCount: this.activeRequests.size 
        });
        originalEnd.apply(res, args);
      };

      // Track when request errors
      res.on('error', () => {
        this.activeRequests.delete(requestId);
        logger.debug("Request errored", { 
          requestId, 
          method: req.method, 
          url: req.url,
          activeCount: this.activeRequests.size 
        });
      });

      next();
    };
  }

  // Wait for all active requests to complete
  async waitForAllRequests(timeoutMs = 10000) {
    const startTime = Date.now();
    
    logger.info("Waiting for active requests to complete", { 
      activeCount: this.activeRequests.size,
      timeout: timeoutMs 
    });

    while (this.activeRequests.size > 0) {
      const elapsed = Date.now() - startTime;
      
      if (elapsed >= timeoutMs) {
        logger.warn("Request completion timeout reached", { 
          remainingRequests: this.activeRequests.size,
          elapsed 
        });
        break;
      }

      // Wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    logger.info("Request wait completed", { 
      remainingRequests: this.activeRequests.size,
      elapsed: Date.now() - startTime 
    });
  }

  getActiveRequestCount() {
    return this.activeRequests.size;
  }

  hasActiveRequests() {
    return this.activeRequests.size > 0;
  }
}

// Create singleton instance
const requestTracker = new RequestTracker();

export default requestTracker;
