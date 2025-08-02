import prisma from "../config/db.js";
import { logger } from "../utils/logger.js";
import { webChatSocketService } from "./webChatSocketService.js";
import * as dotenv from 'dotenv';

dotenv.config();


// WhatsApp number formatting utility
function formatWhatsAppNumber(phone) {
  // Remove any non-digit characters
  const cleaned = phone.replace(/[^0-9]/g, '');
  // Add country code if missing (assuming default country code +1)
  if (cleaned.startsWith('1')) {
    return cleaned;
  } else if (!cleaned.startsWith('1') && cleaned.length === 10) {
    return `1${cleaned}`;
  }
  return cleaned;
}

// Check if business exists helper
async function checkBusinessExists(businessId) {
  try {
    const business = await prisma.business.findUnique({
      where: { id: businessId }
    });

    if (!business) {
      throw new Error(`Business with ID '${businessId}' does not exist. Please create the business first before using WhatsApp service.`);
    }

    return business;
  } catch (error) {
    logger.logError(error, { context: "checkBusinessExists", businessId });
    throw error;
  }
}

// Process message with WebSocket chatbot service
async function processWithAI(message, phoneNumber, business) {
  try {
    logger.info("Processing WhatsApp message with WebSocket chatbot service", { 
      phoneNumber, 
      businessId: business.id,
      chatbotId: business.chatbotId,
      message: message.substring(0, 50) + (message.length > 50 ? '...' : '')
    });

    // Create platform message object for WebSocket service
    const platformMessage = {
      content: message,
      threadId: phoneNumber,
      email: `whatsapp_${phoneNumber}@business.com`,
      timestamp: new Date()
    };

    // Use WebSocket service to handle streaming response and get the full response
    const aiResponse = await webChatSocketService.forwardPlatformMessageToGenistudio(
      business.chatbotId,
      platformMessage,
      'whatsapp'
    );

    logger.info("AI Response generated for WhatsApp via WebSocket chatbot", { 
      phoneNumber, 
      businessId: business.id,
      chatbotId: business.chatbotId,
      responseLength: aiResponse ? aiResponse.length : 0 
    });

    return aiResponse;
  } catch (error) {
    logger.logError(error, { 
      context: "processWithAI", 
      phoneNumber, 
      businessId: business.id,
      chatbotId: business.chatbotId 
    });
    
    // Return a fallback response instead of throwing error
    return "I'm sorry, I'm having trouble processing your message right now. Please try again later.";
  }
}

// Process individual WhatsApp message with immediate response
async function processMessage(phoneNumber, messageText, business) {
  try {
    logger.info("Processing WhatsApp message", { phoneNumber, messageText });
    console.log("Processing WhatsApp message for business:", business.id);
    const businessId = business.id;
    console.log("Business ID:", businessId);
    // const business = await checkBusinessExists(businessId);

    // Process with AI and get response immediately
    const aiResponse = await processWithAI(messageText, phoneNumber, business);

    // Send AI response back via WhatsApp immediately
    if (aiResponse) {
      const sendResult = await sendWhatsAppMessage(phoneNumber, aiResponse, 2, business);
      
      // Broadcast success to WebSocket clients for real-time monitoring
      webChatSocketService.broadcastToBusinessClients(business.chatbotId, {
        type: 'whatsapp_message_processed',
        data: {
          platform: 'whatsapp',
          phoneNumber: phoneNumber,
          userMessage: messageText,
          botResponse: aiResponse,
          messageId: sendResult?.id,
          status: sendResult?.status || 'sent',
          timestamp: new Date()
        }
      });
      
      logger.info("WhatsApp message processed and response sent", {
        phoneNumber,
        messageId: sendResult?.id,
        responseLength: aiResponse.length
      });
    }

    return { success: true, phoneNumber, processed: true, response: aiResponse };
  } catch (error) {
    logger.logError(error, { context: "processMessage", phoneNumber });
    
    // Send error response to user
    try {
      await sendWhatsAppMessage(phoneNumber, "I apologize, but I'm experiencing technical difficulties. Please try again in a moment.", 2, business);
    } catch (sendError) {
      logger.logError(sendError, { context: "processMessage-errorResponse", phoneNumber });
    }
    
    return { success: false, phoneNumber, error: error.message };
  }
}

// Handle incoming WhatsApp messages
export async function handleWhatsAppMessage(req, res) {
  try {
    logger.info("WhatsApp webhook received", { 
      body: JSON.stringify(req.body).substring(0, 200) + '...',
      headers: req.headers
    });

    const messages = req.body.messages;

    console.log("Received messages:", req.body);
    
    if (!messages || !Array.isArray(messages)) {
      logger.warn("Invalid webhook format - no messages array", { body: req.body });
      return res.status(200).json({ status: 'ok', message: 'No messages to process' });
    }

    const results = [];
    let processedCount = 0;

    for (const message of messages) {
      try {
        logger.info("Processing webhook message", {
          messageId: message.id,
          fromMe: message.from_me,
          chatId: message.chat_id,
          from: message.from,
          type: message.type,
          hasText: !!(message.text?.body || message.body)
        });

        // Skip messages sent by us (outgoing messages)
        if (message.from_me) {
          logger.info("Skipping outgoing message", { 
            messageId: message.id,
            text: message.text?.body || message.body 
          });
          continue;
        }
        
        logger.info("Processing incoming message", {
          messageId: message.id,
          from: message.from,
          chatId: message.chat_id,
          text: message.text?.body || message.body
        });
        
        // Extract phone number and message text
        const chatId = message.chat_id || message.from;
        const isGroup = chatId && chatId.includes('@g.us');
        const phoneNumber = isGroup ? chatId : (chatId ? chatId.split('@')[0] : message.from);
        const messageText = message.text?.body || message.body;
        
        if (!messageText || !phoneNumber) {
          logger.warn("Incomplete message data", { phoneNumber, hasText: !!messageText });
          continue;
        }
        
        // Skip group messages for now - groups require different handling
        if (isGroup) {
          logger.info("Skipping group message - group handling not implemented", { 
            chatId,
            messageText: messageText.substring(0, 50) + (messageText.length > 50 ? '...' : '')
          });
          continue;
        }
        
        logger.info("Generating chatbot response", {
          phoneNumber,
          messageText: messageText.substring(0, 100) + (messageText.length > 100 ? '...' : ''),
          messageId: message.id
        });

        console.log("mes!!", message)

        const business = await Promise.resolve(prisma.business.findUnique({ where: { channelId: req.body.channel_id } }));
        console.log("Jexy!!", business)
        // Process each message and collect results
        const result = await processMessage(phoneNumber, messageText, business);
        results.push(result);
        
        if (result.success) {
          processedCount++;
          logger.info("Chatbot response sent successfully", {
            phoneNumber,
            responseLength: result.response?.length
          });
        } else {
          logger.error("Chatbot response failed", {
            phoneNumber,
            error: result.error
          });
        }
        
      } catch (messageError) {
        logger.logError(messageError, { 
          context: "handleWhatsAppMessage-singleMessage",
          messageId: message.id 
        });
        results.push({ 
          success: false, 
          phoneNumber: message.from || 'unknown',
          error: messageError.message 
        });
      }
    }
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    logger.info("WhatsApp webhook processing completed", {
      totalMessages: messages.length,
      processed: processedCount,
      successful,
      failed
    });
    
    // Always return 200 to acknowledge webhook receipt
    res.status(200).json({ 
      status: 'success',
      processed: results.length,
      successful,
      failed,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.logError(error, { context: "handleWhatsAppMessage-main" });
    
    // Still return 200 to avoid webhook retries
    res.status(200).json({ 
      status: 'error',
      message: 'Webhook processing failed but acknowledged',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

// Send WhatsApp message via API
export async function sendWhatsAppMessage(phoneNumber, messageText, typingTime = 2, business) {
  try {
    // Check if this is a group ID (contains @g.us) and handle accordingly
    const isGroup = phoneNumber && phoneNumber.includes('@g.us');
    const formattedNumber = isGroup ? phoneNumber : formatWhatsAppNumber(phoneNumber);
    const bearerToken = business.whatsappBearerToken;
    const apiUrl = process.env.WHATSAPP_API_URL || 'https://gate.whapi.cloud/messages/text';

    if (!bearerToken) {
      throw new Error("WhatsApp Bearer Token not configured in business record");
    }

    logger.info("Sending WhatsApp message", { 
      phoneNumber: formattedNumber, 
      messageLength: messageText.length,
      typingTime,
      isGroup
    });

    const requestBody = {
      typing_time: typingTime,
      to: formattedNumber,
      body: messageText
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'authorization': `Bearer ${bearerToken}`
      },
      body: JSON.stringify(requestBody)
    });

    const responseText = await response.text();
    let data;
    
    try {
      data = JSON.parse(responseText);
    } catch (error) {
      logger.error('Failed to parse WhatsApp API response', { 
        status: response.status,
        responseText: responseText.substring(0, 500),
        parseError: error.message
      });
      throw new Error(`WhatsApp API returned invalid JSON: ${responseText.substring(0, 100)}`);
    }

    if (!response.ok) {
      logger.error('WhatsApp API Error', {
        status: response.status,
        statusText: response.statusText,
        response: data,
        phoneNumber: formattedNumber
      });
      throw new Error(`WhatsApp API Error: ${response.status} ${response.statusText} - ${data.error || responseText}`);
    }

    logger.info('WhatsApp message sent successfully', { 
      phoneNumber: formattedNumber, 
      messageId: data.id,
      status: data.status || 'sent'
    });
    
    return data;
  } catch (error) {
    logger.logError(error, { 
      context: "sendWhatsAppMessage", 
      phoneNumber,
      messageLength: messageText?.length 
    });
    throw error;
  }
}

// WhatsApp webhook verification for Whapi setup
export function verifyWhatsAppWebhook(req, res) {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  // Get businessId from authenticated request (set by auth middleware)
  const businessId = req.business?.businessId;
  if (!businessId) {
    logger.error('No businessId found in authenticated request');
    return res.status(401).json({ error: 'Unauthorized: businessId missing' });
  }
  checkBusinessExists(businessId).then(business => {
    const verifyToken = business.whatsappVerifyToken;
    if (!verifyToken) {
      logger.error('WHATSAPP_VERIFY_TOKEN not configured in business record');
      return res.status(500).json({ error: 'Webhook verification token not configured' });
    }
    if (mode === 'subscribe' && token === verifyToken) {
      logger.info('WhatsApp webhook verified successfully');
      res.status(200).send(challenge);
    } else {
      logger.warn('WhatsApp webhook verification failed', { 
        mode, 
        tokenMatch: token === verifyToken,
        expectedToken: verifyToken ? '***configured***' : 'not configured'
      });
      res.status(403).json({ error: 'Webhook verification failed' });
    }
  }).catch(error => {
    logger.error('Error fetching business for WhatsApp webhook verification', { error: error.message });
    res.status(500).json({ error: 'Failed to verify webhook' });
  });
}

// Legacy compatibility functions for business controller integration
export async function loginWhatsApp(bareerKey, verificationKey) {
  logger.info("WhatsApp login called");
  
  return {
    success: true,
    serialized: JSON.stringify({
      bareerKey,
      verificationKey,
      sessionId: `wa_${Date.now()}`,
      loginAt: new Date(),
    }),
  };
}

export async function restoreSession(serializedCookies) {
  try {
    const sessionData = JSON.parse(serializedCookies);
    logger.info("Restoring WhatsApp session", { number: sessionData.number });
    
    return {
      success: true,
      sessionData,
    };
  } catch (error) {
    logger.logError(error, { context: "restoreSession" });
    throw error;
  }
}

export async function ensureClient(businessId, serializedCookies) {
  try {
    logger.info("Ensuring WhatsApp client", { businessId });
    
    const sessionData = await restoreSession(serializedCookies);
    return sessionData;
  } catch (error) {
    logger.logError(error, { context: "ensureClient", businessId });
    throw error;
  }
}

export async function fetchRecentMessages(client, limit = 20) {
  logger.info("Fetching WhatsApp messages", { limit });
  
  // This would typically fetch from WhatsApp API or webhook data
  // For now, return empty array as WhatsApp messages come via webhook
  return [];
}

// Simplified legacy compatibility functions
export async function sendMessage(phoneNumber, messageText) {
  return await sendWhatsAppMessage(phoneNumber, messageText);
}

// Export the main WhatsApp service functions
const whatsappService = {
  handleWhatsAppMessage,
  sendWhatsAppMessage,
  verifyWhatsAppWebhook,
  sendMessage,
  formatWhatsAppNumber,
  // Legacy compatibility functions
  loginWhatsApp,
  restoreSession,
  ensureClient,
  fetchRecentMessages,
  // Utility functions for integration
  checkBusinessExists,
  processWithAI
};

export default whatsappService;
