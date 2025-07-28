import prisma from "../config/db.js";
import { webChatSocketService } from "../services/webChatSocketService.js";
import { logger } from "../utils/logger.js";
import {
  ensureClient,
  fetchRecentMessages,
  sendMessage,
} from "../services/instagramService.js";

// Get recent Instagram DMs for a business
export async function getMessages(req, res) {
  const businessId = req.params.businessId;
  const limit = parseInt(req.query.limit) || 20;

  try {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
    });

    if (!business?.instagramSession) {
      return res.status(400).json({
        error: "Instagram session not found for this business",
      });
    }

    const client = await ensureClient(businessId, business.instagramSession);
    const messages = await fetchRecentMessages(client, limit);

    res.status(200).json(messages);
  } catch (err) {
    logger.logError(err, { context: 'getMessages', businessId });
    res.status(500).json({ error: "Failed to fetch messages" });
  }
}

// Send a reply message to a specific Instagram thread
export async function replyToThread(req, res) {
  const { businessId, threadId, text } = req.body;

  try {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
    });

    if (!business?.instagramSession) {
      return res.status(400).json({ error: "Instagram session not found" });
    }

    const client = await ensureClient(businessId, business.instagramSession);
    await sendMessage(client, threadId, text);

    // Broadcast message via WebSocket
    webChatSocketService.broadcastMessage({
      type: 'manual_message_sent',
      data: {
        businessId,
        platform: 'instagram',
        threadId,
        content: text,
        timestamp: new Date(),
        isIncoming: false,
        sender: 'Manual'
      }
    });

    res.status(200).json({ message: "Message sent successfully" });
  } catch (err) {
    logger.logError(err, { context: 'replyToThread', businessId, threadId });
    res.status(500).json({ error: "Failed to send message" });
  }
}
