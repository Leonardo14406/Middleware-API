import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import winston from "winston";
import platformRoutes from "./routes/index.js";

dotenv.config();    
const app = express();

// Configure Logger
export const logger = winston.createLogger({
    level: "info",
    format: winston.format.json(),
    transports: [
        new winston.transports.File({ filename: "error.log", level: "error" }),
        new winston.transports.File({ filename: "combined.log" }),
        new winston.transports.Console(),
    ],
});

// Middleware
app.use(cors());
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/api", platformRoutes);

// Error handling
app.use((err, req, res, next) => {
    logger.error(err.stack);
    res.status(500).send("Internal Server Error");
});

// Start server
const PORT = process.env.PORT || 7001;
app.listen(PORT, async() => {
    logger.info(`Middleware API running on port: ${PORT}`);
});



