import instagramService from "./instagramService.js";
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

        if (!business?.instagramSession) return;

        const client = await instagramService.ensureClient(
          businessId,
          business.instagramSession
        );
        const messages = await instagramService.fetchRecentMessages(client, 10);

        for (const msg of messages) {
          if (!msg.isIncoming) continue;

          const exists = await prisma.message.findFirst({
            where: { businessId, messageId: msg.messageId },
          });

          if (!exists) {
            await prisma.message.create({
              data: {
                businessId,
                threadId: msg.threadId,
                messageId: msg.messageId,
                content: msg.content,
                isIncoming: true,
                timestamp: msg.timestamp,
              },
            });

            await this.processMessage(business, msg);
          }
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

  async processMessage(business, msg) {
    try {
      const reply = await chatbotService.sendMessage(business.chatbotId, msg.content, {
        businessId: business.id,
        threadId: msg.threadId,
        igUsername: business.igUsername,
      });

      if (reply) {
        const client = await instagramService.ensureClient(
          business.id,
          business.instagramSession
        );
        await instagramService.sendMessage(client, msg.threadId, reply);
        await prisma.message.create({
          data: {
            businessId: business.id,
            threadId: msg.threadId,
            messageId: `reply_${Date.now()}`,
            content: reply,
            isIncoming: false,
            timestamp: new Date(),
          },
        });
      }
    } catch (error) {
      logger.logError(error, {
        context: "Reply failed",
        businessId: business.id,
        threadId: msg.threadId,
      });
    }
  }

  async startAllPolling() {
    const businesses = await prisma.business.findMany();
    for (const biz of businesses) {
      if (biz.instagramSession) await this.startPolling(biz.id);
    }
  }

  async stopAllPolling() {
    for (const businessId of this.pollers.keys()) {
      await this.stopPolling(businessId);
    }
  }
}

export const pollingService = new PollingService();
