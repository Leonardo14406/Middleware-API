import axios from "axios";
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

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await axios.post(this.apiUrl, payload, {
          headers: { "Content-Type": "application/json" },
          timeout: 30000,
        });

        return response.data?.reply || null;
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
