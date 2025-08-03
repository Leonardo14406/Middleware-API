import axios from "axios";
import { logger } from "../utils/logger.js";
import { webChatSocketService } from "./webChatSocketService.js";
import * as dotenv from 'dotenv';
import prisma from "../config/db.js";

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
export async function sendMessage(business, recipientId, messageText) {
  try {
    const url = `${process.env.FACEBOOK_API_URL}/me/messages`;
    console.log("Print out mess", business.facebookPageAccessToken)
    const accessToken = business.facebookPageAccessToken;
    if (!accessToken) throw new Error("FACEBOOK_PAGE_ACCESS_TOKEN not set in business record");

    logger.info("Sending Facebook message via Graph API", {
      recipientId: recipientId ? recipientId.substring(0, 10) + "..." : "unknown",
      messageLength: messageText.length
    });

    const payload = {
      recipient: { id: recipientId },
      message: { text: messageText },
      messaging_type: "RESPONSE"
    };

    console.log("Payload for Facebook message", payload)

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
// export async function handleFacebookMessage(req, res) {
//   try {
//     logger.info("Facebook webhook received", {
//       body: JSON.stringify(req.body).substring(0, 200) + '...'
//     });

//     const { entry } = req.body;
//     if (!entry || !Array.isArray(entry)) {
//       logger.warn("Invalid Facebook webhook format - no entry array");
//       return res.status(200).json({ status: 'ok', message: 'No entries to process' });
//     }

//     const businessId = process.env.BUSINESS_ID;
//     if (!businessId) {
//       logger.error("No businessId found in authenticated request");
//       return res.status(401).json({ error: "Unauthorized: businessId missing" });
//     }
//     const business = await checkBusinessExists(businessId);

//     const results = [];
//     for (const entryItem of entry) {
//       if (!entryItem.messaging || !Array.isArray(entryItem.messaging)) continue;
//       for (const messaging of entryItem.messaging) {
//         try {
//           const senderId = messaging.sender?.id;
//           const messageText = messaging && messaging.message && typeof messaging.message.text === 'string' ? messaging.message.text : null;
//           if (!senderId || !messageText) {
//             logger.warn("Skipping Facebook message: missing senderId or messageText", { messaging });
//             continue;
//           }
//           if (messaging.message && messaging.message.is_echo) continue;

//           logger.info("Processing incoming Facebook message", {
//             senderId: senderId ? senderId.substring(0, 10) + "..." : "unknown",
//             messageText: messageText ? messageText.substring(0, 100) + (messageText.length > 100 ? '...' : '') : ""
//           });

//           // Process message with AI
//           const aiResponse = await processMessage(senderId, messageText, business);

//           // Send response back to Facebook
//           if (aiResponse) {
//             await sendMessage(business, senderId, aiResponse);
//             // Broadcast to WebSocket clients
//             webChatSocketService.broadcastToBusinessClients(business.chatbotId, {
//               type: 'facebook_message_processed',
//               data: {
//                 platform: 'facebook',
//                 senderId: senderId ? senderId.substring(0, 10) + "..." : "unknown",
//                 userMessage: messageText,
//                 botResponse: aiResponse,
//                 timestamp: new Date()
//               }
//             });
//             results.push({ success: true, senderId, processed: true });
//             logger.info("Facebook response sent successfully", {
//               senderId: senderId ? senderId.substring(0, 10) + "..." : "unknown",
//               responseLength: aiResponse.length
//             });
//           }
//         } catch (error) {
//           logger.error("Error processing Facebook message entry", {
//             error: error.message,
//             entryItem: JSON.stringify(entryItem)
//           });
//           results.push({ success: false, error: error.message });
//         }
//       }
//     }

//     return res.status(200).json({ status: 'ok', results });
//   } catch (error) {
//     logger.error("Error handling Facebook webhook", {
//       error: error.message,
//       stack: error.stack
//     });
//     return res.status(500).json({ error: "Internal server error" });
//   }
// }

// Process individual Facebook webhook event
export async function processWebhookEvent(webhookEvent) {
  try {
    const senderId = webhookEvent?.sender?.id;
    const recipientId = webhookEvent?.recipient?.id;
    console.log("Recipient ID:", recipientId)
    

    // If business is not provided, fetch it using the recipient ID
    const businessRecord = await prisma.business.findUnique({ 
      where: { recipientId: recipientId } 
    });
    
    if (!businessRecord) {
      logger.error("No business found for recipient ID", {
        recipientId,
        senderId: senderId ? senderId.substring(0, 10) + "..." : "unknown"
      });
      return;
    }
    
    console.log("Found business:", businessRecord.id)
    const business = await checkBusinessExists(businessRecord.id);
    console.log("Fetched business object:", business)
   
    
    const messageText = webhookEvent?.message?.text;
    if (!senderId || !messageText) {
      logger.info("Skipping Facebook event - missing sender or text", {
        hasSender: !!senderId,
        hasText: !!messageText
      });
      return;
    }
    console.log("About to call processMessage with:", { senderId, messageText, businessId: business?.id })
    // Process message with AI
    const aiResponse = await processMessage(senderId, messageText, business);
    console.log("Got AI response:", aiResponse)
    console.log("Got AI response:", aiResponse)
    // Send response back to Facebook
    if (aiResponse) {
      console.log("About to call sendMessage with:", { business: business?.id, senderId, aiResponse: aiResponse?.substring(0, 50) })
      await sendMessage(business, senderId, aiResponse );
      console.log("sendMessage completed successfully")
      // Broadcast to WebSocket clients
      console.log("About to broadcast to WebSocket clients")
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
      error: error && error.message ? error.message : String(error),
      senderId: webhookEvent?.sender?.id ? webhookEvent.sender.id.substring(0, 10) + "..." : "unknown",
      recipientId: webhookEvent?.recipient?.id,
      webhookEvent // Log the full event for debugging
    });
  }
}

// Check if business exists and is active
async function checkBusinessExists(businessId) {
  try {
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
