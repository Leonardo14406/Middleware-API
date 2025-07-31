import axios from "axios";
import { logger } from "../utils/logger.js";
import { webChatSocketService } from "./webChatSocketService.js";
import * as dotenv from 'dotenv';

dotenv.config();

// Process incoming Facebook message with AI and send response
async function processMessage(senderId, messageText, business) {
  try {
    logger.info("Processing Facebook message", {
      senderId: senderId ? senderId.substring(0, 10) + "..." : "unknown",
      businessId: business.id,
      chatbotId: business.chatbotId,
      message: messageText ? messageText.substring(0, 50) + (messageText.length > 50 ? '...' : '') : ""
    });

    const platformMessage = {
      content: messageText,
      threadId: senderId,
      email: `facebook_${senderId}@business.com`,
      timestamp: new Date()
    };

    // Use WebSocket service to handle streaming response
    const aiResponse = await webChatSocketService.forwardPlatformMessageToGenistudio(
      business.chatbotId,
      platformMessage,
      'facebook'
    );

    logger.info("AI Response generated for Facebook", {
      senderId: senderId ? senderId.substring(0, 10) + "..." : "unknown",
      businessId: business.id,
      chatbotId: business.chatbotId,
      responseLength: aiResponse ? aiResponse.length : 0
    });

    return aiResponse;
  } catch (error) {
    logger.error("Error processing Facebook message with AI", {
      senderId: senderId ? senderId.substring(0, 10) + "..." : "unknown",
      businessId: business.id,
      error: error.message
    });
    return "I'm sorry, I'm having trouble processing your message right now. Please try again later.";
  }
}

// Send Facebook message using Graph API
export async function sendMessage(_bot, recipientId, messageText) {
  try {
    const url = `${process.env.FACEBOOK_API_URL}/me/messages`;
    const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    if (!accessToken) throw new Error("FACEBOOK_PAGE_ACCESS_TOKEN not set in .env");

    logger.info("Sending Facebook message via Graph API", {
      recipientId: recipientId ? recipientId.substring(0, 10) + "..." : "unknown",
      messageLength: messageText.length
    });

    const payload = {
      recipient: { id: recipientId },
      message: { text: messageText },
      messaging_type: "RESPONSE"
    };

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    };

    const response = await axios.post(url, payload, { headers });
    logger.info("Facebook message sent successfully", {
      recipientId: recipientId ? recipientId.substring(0, 10) + "..." : "unknown",
      response: response.data
    });
    return response.data;
  } catch (error) {
    logger.error("Failed to send Facebook message via Graph API", {
      error: error.message,
      recipientId: recipientId ? recipientId.substring(0, 10) + "..." : "unknown"
    });
    throw error;
  }
}

// Handle Facebook webhook messages
export async function handleFacebookMessage(req, res) {
  try {
    logger.info("Facebook webhook received", {
      body: JSON.stringify(req.body).substring(0, 200) + '...'
    });

    const { entry } = req.body;
    if (!entry || !Array.isArray(entry)) {
      logger.warn("Invalid Facebook webhook format - no entry array");
      return res.status(200).json({ status: 'ok', message: 'No entries to process' });
    }

    const results = [];
    for (const entryItem of entry) {
      if (!entryItem.messaging) continue;
      for (const messaging of entryItem.messaging) {
        try {
          const senderId = messaging.sender?.id;
          const messageText = messaging.message?.text;
          if (!senderId || !messageText) continue;
          if (messaging.message?.is_echo) continue;

          logger.info("Processing incoming Facebook message", {
            senderId: senderId ? senderId.substring(0, 10) + "..." : "unknown",
            messageText: messageText ? messageText.substring(0, 100) + (messageText.length > 100 ? '...' : '') : ""
          });

          // Get businessId from authenticated request (set by auth middleware)
          // const businessId = req.business?.businessId;
          // if (!businessId) {
          //   logger.error("No businessId found in authenticated request");
          //   return res.status(401).json({ error: "Unauthorized: businessId missing" });
          // }
          const businessId = process.env.BUSINESS_ID
          const business = await checkBusinessExists(businessId);

          // Process message with AI
          const aiResponse = await processMessage(senderId, messageText, business);

          // Send response back to Facebook
          if (aiResponse) {
            await sendMessage(null, senderId, aiResponse);
            // Broadcast to WebSocket clients
            webChatSocketService.broadcastToBusinessClients(business.chatbotId, {
              type: 'facebook_message_processed',
              data: {
                platform: 'facebook',
                senderId: senderId ? senderId.substring(0, 10) + "..." : "unknown",
                userMessage: messageText,
                botResponse: aiResponse,
                timestamp: new Date()
              }
            });
            results.push({ success: true, senderId, processed: true });
            logger.info("Facebook response sent successfully", {
              senderId: senderId ? senderId.substring(0, 10) + "..." : "unknown",
              responseLength: aiResponse.length
            });
          }
        } catch (messageError) {
          logger.error("Error processing individual Facebook message", {
            error: messageError.message,
            senderId: messaging.sender?.id ? messaging.sender.id.substring(0, 10) + "..." : "unknown"
          });
          results.push({
            success: false,
            senderId: messaging.sender?.id || 'unknown',
            error: messageError.message
          });
        }
      }
    }
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    logger.info("Facebook webhook processing completed", {
      totalMessages: results.length,
      successful,
      failed
    });
    res.status(200).json({
      status: 'success',
      processed: results.length,
      successful,
      failed,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error("Facebook webhook processing failed", { error: error.message });
    res.status(200).json({
      status: 'error',
      message: 'Webhook processing failed but acknowledged',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

// Verify Facebook webhook (unchanged)
export function verifyFacebookWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const verifyToken = process.env.FACEBOOK_VERIFY_TOKEN;
  if (!verifyToken) {
    logger.error('FACEBOOK_VERIFY_TOKEN not configured in environment variables');
    return res.status(500).json({ error: 'Webhook verification token not configured' });
  }
  if (mode === 'subscribe' && token === verifyToken) {
    logger.info('Facebook webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    logger.warn('Facebook webhook verification failed', {
      mode,
      tokenMatch: token === verifyToken,
      expectedToken: verifyToken ? '***configured***' : 'not configured'
    });
    res.status(403).json({ error: 'Webhook verification failed' });
  }
}

// Check if business exists (same as WhatsApp service)
async function checkBusinessExists(businessId) {
  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) {
      throw new Error(`Business with ID '${businessId}' does not exist. Please create the business first before using Facebook service.`);
    }
    return business;
  } catch (error) {
    logger.error("Error checking business exists", { context: "checkBusinessExists", businessId, error: error.message });
    throw error;
  }
}

// Process a single normalized Facebook webhook event
export async function processWebhookEvent(webhookEvent) {
  try {
    const senderId = webhookEvent?.sender?.id;
    const messageText = webhookEvent?.message?.text;
    const timestamp = webhookEvent?.timestamp;

    if (!senderId || !messageText) {
      logger.info("Skipping Facebook event - missing sender or text", {
        hasSender: !!senderId,
        hasText: !!messageText
      });
      return;
    }

    // const businessId = req.business?.businessId;
    // if (!businessId) {
    //   logger.error("No businessId found in authenticated request");
    //   return res.status(401).json({ error: "Unauthorized: businessId missing" });
    // }
    const businessId = process.env.BUSINESS_ID
    const business = await checkBusinessExists(businessId);

    // Process message with AI
    const aiResponse = await processMessage(senderId, messageText, business);

    // Send response back to Facebook
    if (aiResponse) {
      await sendMessage(null, senderId, aiResponse);
      // Broadcast to WebSocket clients
      webChatSocketService.broadcastToBusinessClients(business.chatbotId, {
        type: 'facebook_message_processed',
        data: {
          platform: 'facebook',
          senderId: senderId ? senderId.substring(0, 10) + "..." : "unknown",
          userMessage: messageText,
          botResponse: aiResponse,
          timestamp: new Date()
        }
      });
      logger.info("Facebook response sent successfully", {
        senderId: senderId ? senderId.substring(0, 10) + "..." : "unknown",
        responseLength: aiResponse.length
      });
    }
  } catch (error) {
    logger.error("Error processing individual Facebook webhook event", {
      error: error && error.message ? error.message : String(error)
    });
  }
}

// Export the main Facebook service functions
const facebookService = {
  sendMessage,
  handleFacebookMessage,
  verifyFacebookWebhook
};

export default facebookService;
