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

// Simulate an incoming message for testing purposes
router.post("/simulate-incoming", async (req, res) => {
  try {
    const { phoneNumber, message } = req.body;
    
    if (!phoneNumber || !message) {
      return res.status(400).json({ 
        error: "phoneNumber and message are required" 
      });
    }
    
    // Create a fake incoming message payload
    const fakeIncomingMessage = {
      messages: [{
        id: `sim_${Date.now()}`,
        from_me: false, // This is the key - incoming message
        type: "text",
        chat_id: `${phoneNumber}@s.whatsapp.net`,
        from: phoneNumber,
        timestamp: Math.floor(Date.now() / 1000),
        source: "web",
        device_id: 1,
        status: "received",
        text: {
          body: message
        }
      }]
    };
    
    logger.info("🧪 SIMULATION - Processing fake incoming message", {
      phoneNumber,
      message,
      simulationId: fakeIncomingMessage.messages[0].id
    });
    
    // Process the simulated incoming message
    const { handleWhatsAppMessage } = await import("../services/whatsappService.js");
    
    // Create a fake request/response for the handler
    const fakeReq = {
      body: fakeIncomingMessage,
      headers: { 'content-type': 'application/json' }
    };
    
    const fakeRes = {
      status: (code) => ({
        json: (data) => {
          res.json({
            success: true,
            message: "Simulated incoming message processed",
            statusCode: code,
            response: data,
            simulation: {
              phoneNumber,
              originalMessage: message,
              messageId: fakeIncomingMessage.messages[0].id
            }
          });
        }
      })
    };
    
    await handleWhatsAppMessage(fakeReq, fakeRes);
    
  } catch (error) {
    logger.logError(error, { context: "WhatsApp simulate-incoming endpoint" });
    res.status(500).json({ 
      error: "Failed to simulate incoming message",
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
