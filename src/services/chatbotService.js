import axios from "axios";
import { webChatSocketService } from "./webChatSocketService.js";
import { logger } from "../utils/logger.js";

class ChatbotService {
  constructor() {
    this.apiUrl = process.env.GENISTUDIO_API_URL || "https://genistud.io/api/message";
    this.messagesUrl = process.env.GENISTUDIO_MESSAGES_URL || "https://genistud.io/api/getmessages";
    this.maxRetries = 3;
  }

  async sendMessage(chatbotId, message, context = {}) {
    const requestId = `req_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const startTime = Date.now();
    
    logger.info('Sending message to Genistudio', {
      requestId,
      chatbotId,
      message: message.substring(0, 200) + (message.length > 200 ? '...' : ''),
      context: {
        threadId: context.threadId,
        platform: context.platform,
        businessId: context.businessId,
        email: context.email
      }
    });

    // Prepare the payload according to the working example
    const payload = {
      chatbotId: chatbotId,
      email: context.email || process.env.GUEST_EMAIL || 'guest@example.com',
      message: message,
      sessionId: context.threadId || `sess_${Date.now()}`
    };

    try {
      logger.debug('Sending request to Genistudio API', {
        requestId,
        url: this.apiUrl,
        payload: {
          ...payload,
          message: payload.message.substring(0, 100) + (payload.message.length > 100 ? '...' : '')
        }
      });

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Genistudio API error response', {
          requestId,
          status: response.status,
          statusText: response.statusText,
          response: errorText
        });
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
      }

      // Handle streaming response
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No reader available in the response");
      }

      const decoder = new TextDecoder();
      let fullResponse = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        fullResponse += decoder.decode(value, { stream: true });
        
        // Broadcast the chunk via WebSocket if we have a threadId
        if (context.threadId) {
          const chunk = decoder.decode(value, { stream: true });
          webChatSocketService.broadcastToThread(
            context.threadId,
            { 
              type: 'chunk', 
              content: chunk
            }
          );
        }
      }

      logger.info('Received complete response from Genistudio', {
        requestId,
        responseLength: fullResponse.length,
        timeElapsed: `${Date.now() - startTime}ms`
      });

      return fullResponse;

    } catch (error) {
      logger.error('Error in sendMessage:', {
        requestId,
        error: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText
      });
      throw error;
    }
  }

  // Add this method to fetch message history
  async getMessages(chatbotId, email, limit = 20, cursor = null) {
    try {
      const payload = {
        chatbotId: chatbotId,
        email: email,
        limit: limit
      };
      
      if (cursor) {
        payload.cursor = cursor;
      }
      
      const response = await fetch(this.messagesUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data.messages || [];

    } catch (error) {
      logger.error('Error fetching messages:', {
        chatbotId,
        email,
        error: error.message
      });
      return [];
    }
  }
}

export const chatbotService = new ChatbotService();