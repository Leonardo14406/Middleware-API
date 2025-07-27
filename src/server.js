import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import businessRoutes from "./routes/businessRoutes.js";
import instagramRoutes from "./routes/instagramRoute.js";
import { pollingService } from "./services/pollingService.js";
import { logger } from "./utils/logger.js";

dotenv.config();
const app = express();

// Middleware
app.use(cors());
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/business", businessRoutes);
app.use("/instagram", instagramRoutes);

// Global error handler
app.use((err, req, res, next) => {
  logger.logError(err, { context: "Unhandled error" });
  res.status(500).json({ error: "Internal Server Error" });
});

// Start server
const PORT = process.env.PORT || 7001;
app.listen(PORT, async () => {
  logger.info(`Middleware API running on port: ${PORT}`);

  try {
    await pollingService.startAllPolling();
    logger.info("Polling service started");
  } catch (err) {
    logger.logError(err, { context: "Failed to start polling service" });
  }
});
