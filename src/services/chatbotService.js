import axios from "axios";
import { webChatSocketService } from "./webChatSocketService.js";
import { logger } from "../utils/logger.js";

class ChatbotService {
  constructor() {
    this.apiUrl = process.env.CHATBOT_API_URL || "https://genistud.io/api/message";
    this.maxRetries = 3;
  }

  async sendMessage(chatbotId, message, context = {}) {
    const payload = {
      chatbotId,
      message,
      context,
      timestamp: new Date().toISOString(),
    };

    // If email is provided in context, we can use it for WebSocket targeting
    const email = context.email;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await axios.post(this.apiUrl, payload, {
          headers: { "Content-Type": "application/json" },
          timeout: 30000,
          responseType: 'stream'
        });

        let fullReply = '';

        // If we have email context, stream the response via WebSocket
        if (email && context.platform && context.threadId) {
          for await (const chunk of response.data) {
            const chunkText = chunk.toString();
            fullReply += chunkText;
            
            // Broadcast each chunk via WebSocket
            webChatSocketService.broadcastToBusinessClients(chatbotId, {
              type: 'platform_bot_chunk',
              data: {
                platform: context.platform,
                threadId: context.threadId,
                businessId: context.businessId,
                chunk: chunkText,
                isComplete: false,
                timestamp: new Date()
              }
            });
          }

          // Send completion message
          webChatSocketService.broadcastToBusinessClients(chatbotId, {
            type: 'platform_bot_complete',
            data: {
              platform: context.platform,
              threadId: context.threadId,
              businessId: context.businessId,
              fullMessage: fullReply,
              isComplete: true,
              timestamp: new Date()
            }
          });

          return fullReply;
        } else {
          // Fallback for non-streaming or direct API calls
          const responseData = await new Promise((resolve, reject) => {
            let data = '';
            response.data.on('data', chunk => data += chunk);
            response.data.on('end', () => resolve(data));
            response.data.on('error', reject);
          });

          return responseData || null;
        }

      } catch (error) {
        logger.logError(error, {
          context: "Chatbot sendMessage failed",
          chatbotId,
          attempt,
        });

        if (attempt < this.maxRetries) {
          const delay = 500 * 2 ** (attempt - 1); // 500ms → 1s → 2s
          await new Promise((res) => setTimeout(res, delay));
        } else {
          throw new Error("Chatbot API error after retries");
        }
      }
    }
  }
}

export const chatbotService = new ChatbotService();
