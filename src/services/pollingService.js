import instagramService from "./instagramService.js";
import facebookService from "./facebookService.js";
import { webChatSocketService } from "./webChatSocketService.js";
import { chatbotService } from "./chatbotService.js";
import { logger } from "../utils/logger.js";
import prisma from "../config/db.js";

class PollingService {
  constructor() {
    this.pollers = new Map();
    this.pollInterval = 30000; // 30 seconds
  }

  async startPolling(businessId) {
    if (this.pollers.has(businessId)) {
      logger.debug(`Polling already active for business: ${businessId}`);
      return;
    }

    const poll = async () => {
      try {
        logger.debug(`Polling for business: ${businessId}`);
        const business = await prisma.business.findUnique({
          where: { id: businessId },
        });

        if (!business) {
          logger.warn(`Business not found: ${businessId}`);
          this.stopPolling(businessId);
          return;
        }

        if (business.instagramSession) {
          await this.pollInstagram(business);
        }

        if (business.facebookPageId && business.facebookAccessToken) {
          await this.pollFacebook(business);
        }
      } catch (error) {
        logger.error(`Polling error for business ${businessId}:`, error);
      }
    };

    // Start polling
    this.pollers.set(businessId, setInterval(poll, this.pollInterval));
    
    // Initial poll
    await poll();
    
    logger.info(`Started polling for business: ${businessId}`);
  }

  async stopPolling(businessId) {
    const interval = this.pollers.get(businessId);
    if (interval) {
      clearInterval(interval);
      this.pollers.delete(businessId);
      logger.info(`Stopped polling for business: ${businessId}`);
    }
  }

  async pollInstagram(business) {
    const pollId = `poll_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const startTime = Date.now();
    
    logger.info(`Starting Instagram poll for business`, {
      pollId,
      businessId: business.id,
      businessName: business.name,
      hasChatbotId: !!business.chatbotId,
      timestamp: new Date().toISOString()
    });

    try {
      // Get the latest active Instagram session for this business
      const session = await prisma.session.findFirst({
        where: {
          businessId: business.id,
          platform: 'INSTAGRAM',
          expiresAt: { gt: new Date() },
          serializedCookies: { not: null }
        },
        orderBy: { expiresAt: 'desc' },
        take: 1
      });

      if (!session) {
        logger.warn('No active Instagram session found for business', {
          pollId,
          businessId: business.id,
          businessName: business.name
        });
        return;
      }

      logger.debug('Found active Instagram session', {
        pollId,
        businessId: business.id,
        sessionId: session.id,
        expiresAt: session.expiresAt,
        hasSerializedCookies: !!session.serializedCookies
      });

      let client;
      try {
        client = await instagramService.ensureClient(
          business.id,
          session.serializedCookies
        );
        logger.debug('Successfully initialized Instagram client', {
          pollId,
          businessId: business.id
        });
      } catch (clientError) {
        logger.error('Failed to initialize Instagram client', {
          pollId,
          businessId: business.id,
          error: clientError.message,
          stack: clientError.stack
        });
        throw clientError;
      }

      let messages = [];
      try {
        messages = await instagramService.fetchRecentMessages(client, 10);
        logger.debug(`Fetched ${messages.length} messages from Instagram`, {
          pollId,
          businessId: business.id,
          messageCount: messages.length,
          messageIds: messages.map(m => m.messageId),
          timeElapsed: `${Date.now() - startTime}ms`
        });
      } catch (fetchError) {
        logger.error('Failed to fetch messages from Instagram', {
          pollId,
          businessId: business.id,
          error: fetchError.message,
          stack: fetchError.stack
        });
        throw fetchError;
      }

      // Process each message
      let processedCount = 0;
      for (const msg of messages) {
        try {
          await this.processMessage(business, msg, 'instagram');
          processedCount++;
        } catch (processError) {
          logger.error('Error processing Instagram message', {
            pollId,
            businessId: business.id,
            messageId: msg.messageId,
            threadId: msg.threadId,
            error: processError.message,
            stack: processError.stack
          });
        }
      }

      logger.info('Completed Instagram poll', {
        pollId,
        businessId: business.id,
        businessName: business.name,
        messagesFetched: messages.length,
        messagesProcessed: processedCount,
        timeElapsed: `${Date.now() - startTime}ms`
      });
    } catch (error) {
      logger.error('Instagram polling failed', {
        pollId,
        businessId: business.id,
        error: error.message,
        stack: error.stack,
        timeElapsed: `${Date.now() - startTime}ms`
      });
      throw error;
    }
  }

  async pollFacebook(business) {
    // Similar implementation to pollInstagram but for Facebook
    // Implementation omitted for brevity
  }

  async processMessage(business, msg, platform) {
    const processId = `proc_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const startTime = Date.now();

    logger.info('Processing incoming message', {
      processId,
      businessId: business.id,
      platform,
      threadId: msg.threadId,
      messageId: msg.messageId,
      isIncoming: msg.isIncoming,
      content: msg.content?.substring(0, 200) + (msg.content?.length > 200 ? '...' : ''),
      timestamp: new Date().toISOString()
    });

    // Skip processing if this is an outgoing message from us
    if (msg.isIncoming === false) {
      logger.debug('Skipping outgoing message', {
        processId,
        businessId: business.id,
        platform,
        threadId: msg.threadId,
        messageId: msg.messageId
      });
      return;
    }

    try {
      // Broadcast the incoming message
      this.broadcastNewMessage(business, msg, platform);
      
      logger.debug('Broadcasted incoming message', {
        processId,
        businessId: business.id,
        platform,
        threadId: msg.threadId
      });

      // Check if business has a chatbot configured
      if (!business.chatbotId) {
        logger.warn('No chatbot configured for business', {
          processId,
          businessId: business.id,
          platform
        });
        return;
      }

      // Prepare context for the chatbot
      const context = {
        threadId: msg.threadId,
        platform: platform,
        businessId: business.id,
        email: business.email || process.env.GUEST_EMAIL || 'guest@example.com',
        timestamp: msg.timestamp || new Date().toISOString(),
        // Add additional context that might be useful for the chatbot
        userInfo: {
          platformUserId: msg.senderId || 'unknown',
          threadId: msg.threadId
        }
      };
      
      // Log the context being sent to the chatbot
      logger.debug('Prepared chatbot context', {
        processId,
        businessId: business.id,
        threadId: msg.threadId,
        hasEmail: !!context.email,
        platform: platform
      });

      logger.debug('Sending message to ChatbotService', {
        processId,
        businessId: business.id,
        chatbotId: business.chatbotId,
        platform,
        threadId: msg.threadId,
        context
      });

      // Send message to Genistudio via ChatbotService
      let reply;
      try {
        reply = await chatbotService.sendMessage(
          business.chatbotId,
          msg.content,
          context
        );
        
        logger.debug('Successfully sent message to ChatbotService', {
          processId,
          businessId: business.id,
          platform,
          threadId: msg.threadId,
          hasReply: !!reply
        });
      } catch (chatbotError) {
        logger.error('Error sending message to ChatbotService', {
          processId,
          businessId: business.id,
          platform,
          threadId: msg.threadId,
          error: chatbotError.message,
          stack: chatbotError.stack
        });
        throw chatbotError;
      }

      if (reply) {
        logger.info('Received reply from Genistudio', {
          processId,
          businessId: business.id,
          platform,
          threadId: msg.threadId,
          replyLength: reply.length,
          replyPreview: reply.substring(0, 200) + (reply.length > 200 ? '...' : ''),
          timeElapsed: `${Date.now() - startTime}ms`
        });

        // Send the reply back to the platform
        if (platform === "instagram") {
          logger.debug('Preparing to send reply to Instagram', {
            processId,
            businessId: business.id,
            threadId: msg.threadId,
            replyLength: reply.length
          });
          
          // Get the latest active Instagram session for this business
          const session = await prisma.session.findFirst({
            where: {
              businessId: business.id,
              platform: 'INSTAGRAM',
              expiresAt: { gt: new Date() },
              serializedCookies: { not: null }
            },
            orderBy: { expiresAt: 'desc' },
            take: 1
          });

          if (!session) {
            logger.error('No active Instagram session found when trying to send reply', {
              processId,
              businessId: business.id,
              threadId: msg.threadId
            });
            throw new Error('No active Instagram session found');
          }
          
          const client = await instagramService.ensureClient(
            business.id,
            session.accessToken
          );
          
          await instagramService.sendMessage(
            client,
            msg.threadId,
            reply
          );
          
          logger.info('Sent reply to Instagram', {
            processId,
            businessId: business.id,
            threadId: msg.threadId,
            replyLength: reply.length
          });
        }

        // Broadcast the bot's reply
        this.broadcastBotReply(business, msg, reply, platform);
      }
    } catch (error) {
      logger.error('Error processing message', {
        processId,
        businessId: business.id,
        platform,
        threadId: msg.threadId,
        error: error.message,
        stack: error.stack,
        timeElapsed: `${Date.now() - startTime}ms`
      });
      
      // Re-throw to allow the caller to handle the error if needed
      throw error;
    } finally {
      logger.debug('Completed message processing', {
        processId,
        businessId: business.id,
        platform,
        threadId: msg.threadId,
        timeElapsed: `${Date.now() - startTime}ms`
      });
    }
  }

  broadcastNewMessage(business, msg, platform) {
    try {
      webChatSocketService.broadcastToBusinessClients(business.chatbotId, {
        type: 'platform_message',
        data: {
          businessId: business.id,
          platform: platform,
          threadId: msg.threadId,
          messageId: msg.messageId,
          content: msg.content,
          timestamp: msg.timestamp,
          isIncoming: true,
          sender: platform === 'instagram' ? 'Instagram User' : 'Facebook User'
        }
      });

      logger.info('Broadcasted platform message via WebSocket', {
        businessId: business.id,
        platform,
        threadId: msg.threadId,
        messageId: msg.messageId
      });
    } catch (error) {
      logger.error('Error broadcasting new message', {
        businessId: business.id,
        platform,
        threadId: msg.threadId,
        error: error.message,
        stack: error.stack
      });
    }
  }

  broadcastBotReply(business, originalMsg, reply, platform) {
    try {
      webChatSocketService.broadcastToBusinessClients(business.chatbotId, {
        type: 'bot_reply',
        data: {
          businessId: business.id,
          platform: platform,
          threadId: originalMsg.threadId,
          messageId: `bot_${Date.now()}`,
          content: reply,
          timestamp: new Date().toISOString(),
          isIncoming: false,
          sender: 'Bot',
          inReplyTo: originalMsg.messageId
        }
      });

      logger.info('Broadcasted bot reply via WebSocket', {
        businessId: business.id,
        platform,
        threadId: originalMsg.threadId,
        replyLength: reply.length
      });
    } catch (error) {
      logger.error('Error broadcasting bot reply', {
        businessId: business.id,
        platform,
        threadId: originalMsg.threadId,
        error: error.message,
        stack: error.stack
      });
    }
  }

  async startAllPolling() {
    try {
      // Step 1: Find all active Instagram sessions
      const activeInstagramSessions = await prisma.session.findMany({
        where: {
          platform: 'INSTAGRAM',
          expiresAt: { gt: new Date() },
          serializedCookies: { not: "" }
        },
        select: {
          businessId: true
        },
        distinct: ['businessId'] // Only get one session per business
      });

      // If no active sessions, log and return early
      if (activeInstagramSessions.length === 0) {
        logger.info('No active Instagram sessions found for polling');
        return;
      }

      // Get unique business IDs with active Instagram sessions
      const instagramBusinessIds = activeInstagramSessions.map(s => s.businessId);

      // Find businesses with active Instagram sessions
      const businesses = await prisma.business.findMany({
        where: {
          id: { in: instagramBusinessIds }
        }
      });

      // Start polling for each business with active sessions
      for (const biz of businesses) {
        const hasInstagramSession = biz.sessions && biz.sessions.length > 0;
        
        if (hasInstagramSession) {
          logger.info(`Starting polling for business ${biz.id}`, {
            hasInstagramSession,
            businessId: biz.id
          });
          await this.startPolling(biz.id);
        }
      }
      
      logger.info(`Started polling for ${businesses.length} businesses`);
    } catch (error) {
      logger.error('Error in startAllPolling:', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async stopAllPolling() {
    for (const businessId of this.pollers.keys()) {
      await this.stopPolling(businessId);
    }
  }
}

// Create and export a single instance of PollingService
const pollingService = new PollingService();

export { pollingService };
