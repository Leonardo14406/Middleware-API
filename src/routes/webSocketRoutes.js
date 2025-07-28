import express from "express";
import { webChatSocketService } from "../services/webChatSocketService.js";

const router = express.Router();

// Get WebSocket connection stats
router.get("/stats", (req, res) => {
  try {
    const stats = webChatSocketService.getStats();
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to get WebSocket stats",
      message: error.message
    });
  }
});

// Health check endpoint
router.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "WebSocket service is running",
    endpoint: "/api/webchat/ws"
  });
});

// Broadcast a message to all connected clients (for testing)
router.post("/broadcast", (req, res) => {
  try {
    const { message, type = 'broadcast' } = req.body;
    
    if (!message) {
      return res.status(400).json({
        success: false,
        error: "Message content is required"
      });
    }

    webChatSocketService.broadcastMessage({
      type,
      data: {
        content: message,
        timestamp: new Date(),
        sender: 'System'
      }
    });

    res.json({
      success: true,
      message: "Message broadcasted successfully"
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to broadcast message",
      message: error.message
    });
  }
});

// Get connected clients for a specific business
router.get("/clients/:businessId", (req, res) => {
  try {
    const { businessId } = req.params;
    const stats = webChatSocketService.getStats();
    
    const businessClients = stats.connections.filter(
      client => client.email && client.email.includes(businessId)
    );

    res.json({
      success: true,
      data: {
        businessId,
        clientCount: businessClients.length,
        clients: businessClients
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to get business clients",
      message: error.message
    });
  }
});

export default router;
