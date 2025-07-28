import instagramService from "./instagramService.js";
import facebookService from "./facebookService.js";
import { chatbotService } from "./chatbotService.js";
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
      const reply = await chatbotService.sendMessage(
        business.chatbotId,
        msg.content,
        {
          businessId: business.id,
          threadId: msg.threadId,
          platform,
        },
      );

      if (reply) {
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
      }
    } catch (error) {
      logger.logError(error, {
        context: `Reply failed on ${platform}`,
        businessId: business.id,
        threadId: msg.threadId,
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
