import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import rateLimit from 'express-rate-limit';
import businessRoutes from './routes/businessRoutes.js';
import instagramRoutes from './routes/instagramRoute.js';
import facebookRoutes from './routes/facebookRoute.js';
import webSocketRoutes from './routes/webSocketRoutes.js';
import whatsappRoutes from './routes/whatsappRoute.js';
import { pollingService } from './services/pollingService.js';
import { webChatSocketService } from './services/webChatSocketService.js';
import { logger } from './utils/logger.js';
import { initQueue, startQueueWorker, clearQueue } from './services/queueService.js';
import { withRetry } from './services/pollingService.js';

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
const app = express();

// Rate limiter for public routes
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: { error: 'Too many requests, please try again later.' },
});

// Middleware
app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(','),
  credentials: true,
}));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Allow inline scripts for frontend
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: [
        "'self'",
        `ws://${process.env.HOST || 'localhost'}:${process.env.PORT || 3000}`,
        `wss://${process.env.HOST || 'localhost'}:${process.env.PORT || 3000}`,
        `http://${process.env.HOST || 'localhost'}:${process.env.PORT || 3000}`,
        `https://${process.env.HOST || 'localhost'}:${process.env.PORT || 3000}`,
        process.env.CHATBOT_API_URL || 'https://genistud.io',
      ],
    },
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
const publicPath = path.join(__dirname, '../public');
if (existsSync(publicPath)) {
  app.use(express.static(publicPath));
} else {
  logger.warn('Public directory not found', { path: publicPath });
}

// Routes
app.use('/business', businessRoutes);
app.use('/instagram', instagramRoutes);
app.use('/facebook', facebookRoutes);
app.use('/api/webchat', webSocketRoutes);
app.use('/whatsapp', whatsappRoutes);

// Serve chatbot testing interface at root
app.get('/', publicLimiter, (req, res) => {
  const indexPath = path.join(__dirname, '../public/index.html');
  if (existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    logger.warn('Chatbot testing interface not found', { path: indexPath });
    res.status(404).json({ error: 'Chatbot testing interface not found' });
  }
});

// Global error handler
app.use((err, req, res, _next) => {
  const requestId = `err_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  logger.error('Unhandled error', {
    requestId,
    method: req.method,
    url: req.url,
    error: err.message,
    stack: err.stack,
  });
  res.status(500).json({ error: 'Internal Server Error', requestId });
});

// Create HTTP server
const server = http.createServer(app);

// Initialize WebSocket service
webChatSocketService.initialize(server);

// Initialize services
const initializeServices = async () => {
  const requestId = `init_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  try {
    // Check queue message count before clearing
    const queueCount = await clearQueue(true); // Pass true to check count only
    if (queueCount > 0) {
      logger.warn(`Queue contains ${queueCount} messages, clearing`, { requestId });
      await withRetry(() => clearQueue(), 3, 1000);
    } else {
      logger.info('Queue is empty, no clearing needed', { requestId });
    }

    // Initialize services in parallel where possible
    await Promise.all([
      withRetry(() => initQueue(), 3, 1000).catch(err => {
        logger.error('Failed to initialize queue', { requestId, error: err.message, stack: err.stack });
        throw err;
      }),
      withRetry(() => startQueueWorker(), 3, 1000).catch(err => {
        logger.error('Failed to start queue worker', { requestId, error: err.message, stack: err.stack });
        throw err;
      }),
    ]);

    // Start polling (dependent on queue)
    await withRetry(() => pollingService.startAllPolling(), 3, 1000).catch(err => {
      logger.error('Failed to start polling', { requestId, error: err.message, stack: err.stack });
      throw err;
    });

    logger.info('All services initialized successfully', { requestId });
  } catch (error) {
    logger.error('Failed to initialize services', { requestId, error: error.message, stack: error.stack });
    // Continue running server but mark services as failed
    logger.warn('Server running with partial service initialization', { requestId });
  }
};

// Graceful shutdown
const shutdown = async () => {
  const requestId = `shutdown_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  logger.info('Initiating graceful shutdown', { requestId });

  try {
    await Promise.all([
      pollingService.stopAllPolling().catch(err => {
        logger.error('Failed to stop polling', { requestId, error: err.message, stack: err.stack });
      }),
      clearQueue().catch(err => {
        logger.error('Failed to clear queue', { requestId, error: err.message, stack: err.stack });
      }),
    ]);
    server.close(() => {
      logger.info('Server closed successfully', { requestId });
      process.exit(0);
    });
  } catch (err) {
    logger.error('Error during shutdown', { requestId, error: err.message, stack: err.stack });
    process.exit(1);
  }
};

// Handle process termination
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  logger.info(`Middleware API running on port: ${PORT}`, { requestId: `start_${Date.now()}` });
  logger.info(`WebSocket available at ws://${process.env.HOST || 'localhost'}:${PORT}/api/webchat/ws`, { requestId: `start_${Date.now()}` });
  logger.info(`Chatbot Testing Interface available at http://${process.env.HOST || 'localhost'}:${PORT}`, { requestId: `start_${Date.now()}` });
  await initializeServices();
});