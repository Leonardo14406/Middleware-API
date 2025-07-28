import instagramService from "./instagramService.js";
import facebookService from "./facebookService.js";
import { webChatSocketService } from "./webChatSocketService.js";
import { logger } from "../utils/logger.js";
import prisma from "../config/db.js";

class PollingService {
  constructor() {
    this.pollers = new Map();
    this.pollInterval = 30000;
  }

  async startPolling(businessId) {
    if (this.pollers.has(businessId)) return;

    const poll = async () => {
      try {
        const business = await prisma.business.findUnique({
          where: { id: businessId },
        });

        if (business?.instagramSession) {
          await this.pollInstagram(business);
        }

        if (business?.facebookPageId && business?.facebookAccessToken) {
          await this.pollFacebook(business);
        }
      } catch (error) {
        logger.logError(error, { context: "Polling error", businessId });
      }
    };

    this.pollers.set(businessId, setInterval(poll, this.pollInterval));
    await poll();
  }

  async stopPolling(businessId) {
    const interval = this.pollers.get(businessId);
    if (interval) {
      clearInterval(interval);
      this.pollers.delete(businessId);
    }
  }

  async pollInstagram(business) {
    try {
      const client = await instagramService.ensureClient(
        business.id,
        business.instagramSession,
      );
      const messages = await instagramService.fetchRecentMessages(client, 10);

      for (const msg of messages) {
        if (!msg.isIncoming) continue;

        const exists = await prisma.message.findFirst({
          where: { businessId: business.id, messageId: msg.messageId },
        });

        if (!exists) {
          await prisma.message.create({
            data: {
              businessId: business.id,
              threadId: msg.threadId,
              messageId: msg.messageId,
              content: msg.content,
              isIncoming: true,
              timestamp: msg.timestamp,
              platform: "instagram",
            },
          });

          // Broadcast new message via WebSocket
          this.broadcastNewMessage(business, msg, "instagram");
          await this.processMessage(business, msg, "instagram");
        }
      }
    } catch (error) {
      logger.logError(error, {
        context: "Instagram polling failed",
        businessId: business.id,
      });
    }
  }

  async pollFacebook(business) {
    try {
      const messages = await facebookService.fetchRecentMessages(
        business.facebookPageId,
        business.facebookAccessToken,
      );

      for (const msg of messages) {
        if (!msg.isIncoming) continue;

        const exists = await prisma.message.findFirst({
          where: { businessId: business.id, messageId: msg.messageId },
        });

        if (!exists) {
          await prisma.message.create({
            data: {
              businessId: business.id,
              threadId: msg.threadId,
              messageId: msg.messageId,
              content: msg.content,
              isIncoming: true,
              timestamp: msg.timestamp,
              platform: "facebook",
            },
          });

          // Broadcast new message via WebSocket
          this.broadcastNewMessage(business, msg, "facebook");
          await this.processMessage(business, msg, "facebook");
        }
      }
    } catch (error) {
      logger.logError(error, {
        context: "Facebook polling failed",
        businessId: business.id,
      });
    }
  }

  async processMessage(business, msg, platform) {
    try {
      // Broadcast the incoming message first
      this.broadcastNewMessage(business, msg, platform);

      // Forward the message to Genistudio via WebSocket (streaming response)
      const reply = await webChatSocketService.forwardPlatformMessageToGenistudio(
        business.chatbotId,
        {
          content: msg.content,
          threadId: msg.threadId,
          email: business.email,
          timestamp: msg.timestamp
        },
        platform
      );

      if (reply) {
        // Send the reply back to the platform
        if (platform === "instagram") {
          const client = await instagramService.ensureClient(
            business.id,
            business.instagramSession,
          );
          await instagramService.sendMessage(client, msg.threadId, reply);
        } else if (platform === "facebook") {
          await facebookService.sendMessage(
            business.facebookPageId,
            business.facebookAccessToken,
            msg.threadId,
            reply,
          );
        }

        await prisma.message.create({
          data: {
            businessId: business.id,
            threadId: msg.threadId,
            messageId: `reply_${Date.now()}`,
            content: reply,
            isIncoming: false,
            timestamp: new Date(),
            platform,
          },
        });

        // Broadcast bot reply via WebSocket
        this.broadcastBotReply(business, msg, reply, platform);
      }
    } catch (error) {
      logger.logError(error, {
        context: `Reply failed on ${platform}`,
        businessId: business.id,
        threadId: msg.threadId,
      });
    }
  }

  // Broadcast new incoming message to WebSocket clients
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
        threadId: msg.threadId
      });
    } catch (error) {
      logger.logError(error, {
        context: 'Failed to broadcast platform message via WebSocket',
        businessId: business.id,
        platform
      });
    }
  }

  // Broadcast bot reply to WebSocket clients
  broadcastBotReply(business, originalMsg, reply, platform) {
    try {
      webChatSocketService.broadcastToBusinessClients(business.chatbotId, {
        type: 'bot_reply',
        data: {
          businessId: business.id,
          platform: platform,
          threadId: originalMsg.threadId,
          content: reply,
          timestamp: new Date(),
          isIncoming: false,
          replyTo: originalMsg.messageId,
          sender: 'Bot'
        }
      });

      logger.info('Broadcasted bot reply via WebSocket', {
        businessId: business.id,
        platform,
        threadId: originalMsg.threadId
      });
    } catch (error) {
      logger.logError(error, {
        context: 'Failed to broadcast bot reply via WebSocket',
        businessId: business.id,
        platform
      });
    }
  }

  async startAllPolling() {
    const businesses = await prisma.business.findMany();
    for (const biz of businesses) {
      if (
        biz.instagramSession ||
        (biz.facebookPageId && biz.facebookAccessToken)
      ) {
        await this.startPolling(biz.id);
      }
    }
  }

  async stopAllPolling() {
    for (const businessId of this.pollers.keys()) {
      await this.stopPolling(businessId);
    }
  }
}

export const pollingService = new PollingService();
