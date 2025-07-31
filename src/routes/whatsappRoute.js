import express from "express";
import { 
  handleWhatsAppMessage,
  verifyWhatsAppWebhook
} from "../services/whatsappService.js";
import { logger } from "../utils/logger.js";

const router = express.Router();

// Webhook verification (GET request from WhatsApp)
router.get("/webhook", verifyWhatsAppWebhook);

// Handle incoming messages (POST request from WhatsApp)
router.post("/webhook", async (req, res) => {
  try {
    await handleWhatsAppMessage(req, res);
  } catch (error) {
    logger.logError(error, { context: "WhatsApp webhook handler" });
    res.status(500).json({ error: "Internal server error" });
  }
});

// Test endpoint to verify WhatsApp service is working
router.post("/test", async (req, res) => {
  try {
    const { phoneNumber, message } = req.body;
    
    if (!phoneNumber || !message) {
      return res.status(400).json({ 
        error: "phoneNumber and message are required" 
      });
    }
    
    // Import sendWhatsAppMessage for testing
    const { sendWhatsAppMessage } = await import("../services/whatsappService.js");
    const result = await sendWhatsAppMessage(phoneNumber, message);
    
    res.json({
      success: true,
      message: "Test message sent successfully",
      result
    });
  } catch (error) {
    logger.logError(error, { context: "WhatsApp test endpoint" });
    res.status(500).json({ 
      error: "Failed to send test message",
      details: error.message 
    });
  }
});

// Health check endpoint
router.get("/health", (req, res) => {
  res.json({
    success: true,
    service: "WhatsApp Service",
    status: "running",
    timestamp: new Date().toISOString(),
    endpoints: {
      webhook: "/whatsapp/webhook",
      test: "/whatsapp/test"
    }
  });
});

export default router;
