import redis from '../config/redis.js';
import prisma from '../config/db.js';
import { logger } from '../utils/logger.js';
import { withRetry } from './pollingService.js';

class ChatbotService {
  constructor() {
    this.rateLimitWindow = [];
    this.CONFIG = {
      MESSAGES_PER_MINUTE: 30,
      RATE_LIMIT_WINDOW_MS: 60000,
    };
  }

  async checkRateLimit(requestId) {
    const now = Date.now();
    this.rateLimitWindow = this.rateLimitWindow.filter(
      (ts) => now - ts < this.CONFIG.RATE_LIMIT_WINDOW_MS
    );
    if (this.rateLimitWindow.length >= this.CONFIG.MESSAGES_PER_MINUTE) {
      const timeToWait = this.rateLimitWindow[0] + this.CONFIG.RATE_LIMIT_WINDOW_MS - now;
      if (timeToWait > 0) {
        logger.info(`Chatbot API rate limit approached, pausing for ${timeToWait}ms`, { requestId });
        await new Promise((resolve) => setTimeout(resolve, timeToWait));
      }
    }
    this.rateLimitWindow.push(now);
  }

  async getAIReply(prompt, chatbotId, context = {}) {
    const requestId = `chatbot_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const logContext = {
      requestId,
      chatbotId,
      promptLength: prompt?.length || 0,
      promptPreview: prompt?.substring(0, 100) + (prompt?.length > 100 ? '...' : ''),
      platform: context.platform || 'unknown',
      threadId: context.threadId || 'unknown',
      businessId: context.businessId || 'unknown',
    };

    logger.debug('Requesting AI reply', logContext);

    // Fetch business email for context
    let email = process.env.GUEST_EMAIL || 'guest@example.com';
    try {
      if (context.businessId) {
        const business = await prisma.business.findUnique({
          where: { id: context.businessId },
          select: { email: true },
        });
        email = business?.email || email;
      }
    } catch (dbErr) {
      logger.warn('Failed to fetch business email, using default', { requestId, businessId: context.businessId, error: dbErr.message });
    }

    // Check rate limit
    await this.checkRateLimit(requestId);

    // Check for cached response
    const cacheKey = `chatbot:response:${chatbotId}:${prompt.hashCode()}`;
    try {
      const cachedReply = await redis.get(cacheKey);
      if (cachedReply) {
        logger.debug('Returning cached AI reply', { requestId, chatbotId });
        return cachedReply;
      }
    } catch (redisErr) {
      logger.warn('Failed to check Redis cache', { requestId, error: redisErr.message });
    }

    try {
      const response = await withRetry(
        async () => {
          const apiUrl = process.env.CHATBOT_API_URL || 'https://genistud.io/api/message';
          const headers = {
            'Content-Type': 'application/json',
          };
          if (process.env.CHATBOT_API_KEY) {
            headers['Authorization'] = `Bearer ${process.env.CHATBOT_API_KEY}`;
          }

          const body = JSON.stringify({
            chatbotId,
            email,
            message: prompt,
            ...(process.env.CHATBOT_SUPPORTS_CONTEXT === 'true' && {
              context: {
                platform: context.platform,
                threadId: context.threadId,
                businessId: context.businessId,
                timestamp: context.timestamp,
                userInfo: context.userInfo,
              },
            }),
          });

          const res = await fetch(apiUrl, {
            method: 'POST',
            headers,
            body,
          });

          if (!res.ok) {
            const errorBody = await res.text();
            throw new Error(`HTTP ${res.status}: ${errorBody}`);
          }
          return res;
        },
        3,
        1000
      );

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No reader available for response stream');
      }

      const decoder = new TextDecoder();
      let fullResponse = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        fullResponse += decoder.decode(value, { stream: true });
      }

      // Validate response
      let reply = fullResponse.trim();
      try {
        const parsed = JSON.parse(fullResponse);
        reply = parsed.reply || reply;
        if (!reply) {
          throw new Error('Empty or invalid response from chatbot API');
        }
      } catch (parseErr) {
        logger.debug('Non-JSON response received, treating as plain text', { requestId, response: fullResponse.substring(0, 100) });
        if (!reply) {
          reply = 'Sorry, I received an invalid response from the chatbot.';
        }
      }

      // Cache response
      try {
        await redis.set(cacheKey, reply, 'EX', 3600); // Cache for 1 hour
        logger.debug('Cached AI reply', { requestId, cacheKey });
      } catch (redisErr) {
        logger.warn('Failed to cache chatbot response', { requestId, error: redisErr.message });
      }

      logger.info('AI reply received', {
        requestId,
        responseLength: reply.length,
        chatbotId,
        platform: context.platform,
        threadId: context.threadId,
      });
      return reply;
    } catch (error) {
      logger.error('Failed to get AI reply', {
        context: 'getAIReply',
        requestId,
        chatbotId,
        error: error.message,
        stack: error.stack,
        apiError: error.message.includes('HTTP') ? error.message : 'Unknown API error',
      });

      // Specific fallback messages
      if (error.message.includes('HTTP 429')) {
        return 'Sorry, the chatbot is currently overloaded. Please try again later.';
      } else if (error.message.includes('HTTP 401') || error.message.includes('HTTP 403')) {
        return 'Authentication error with the chatbot service. Please contact support at support@example.com.';
      }
      return 'Sorry, I am having trouble connecting to the AI service.';
    }
  }
}

// Utility to hash strings for caching
String.prototype.hashCode = function () {
  let hash = 0;
  for (let i = 0; i < this.length; i++) {
    const char = this.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return hash;
};

const chatbotService = new ChatbotService();
export const getAIReply = chatbotService.getAIReply.bind(chatbotService);