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
import { logger } from "./utils/logger.js";

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Middleware API is running',
    timestamp: new Date().toISOString()
  });
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
});
