import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import http from "http";
import businessRoutes from "./routes/businessRoutes.js";
import instagramRoutes from "./routes/instagramRoute.js";
import facebookRoutes from "./routes/facebookRoute.js";
import webSocketRoutes from "./routes/webSocketRoutes.js";
import { pollingService } from "./services/pollingService.js";
import { webChatSocketService } from "./services/webChatSocketService.js";
import { logger } from "./utils/logger.js";

dotenv.config();
const app = express();

// Middleware
// app.use(cors());
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/business", businessRoutes);
app.use("/instagram", instagramRoutes);
app.use("/facebook", facebookRoutes);
app.use("/websocket", webSocketRoutes);

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
const PORT = process.env.PORT || 7001;
server.listen(PORT, async () => {
  logger.info(`Middleware API running on port: ${PORT}`);
  logger.info(`WebSocket available at ws://localhost:${PORT}/api/webchat/ws`);

  try {
    await pollingService.startAllPolling();
    logger.info("Polling service started");
  } catch (err) {
    logger.logError(err, { context: "Failed to start polling service" });
  }
});
