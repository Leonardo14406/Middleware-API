import { IgApiClient } from 'instagram-private-api';
import prisma from '../config/db.js';
import { logger } from '../utils/logger.js';
import { enqueueMessage } from './queueService.js';
import { webChatSocketService } from './webChatSocketService.js';

class PollingService {
  constructor() {
    this.pollers = new Map();
    this.basePollInterval = 4000; 
  }

  async startPolling(businessId) {
    if (this.pollers.has(businessId)) {
      logger.debug(`Polling already active for business: ${businessId}`);
      return;
    }

    const poll = async () => {
      const pollId = `poll_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const startTime = Date.now();

      try {
        logger.debug(`Polling for business: ${businessId}`, { pollId });
        const business = await prisma.business.findUnique({
          where: { id: businessId },
          include: { sessions: { where: { platform: 'INSTAGRAM', expiresAt: { gt: new Date() } } } },
        });

        if (!business || !business.sessions[0]) {
          logger.warn(`No business or active Instagram session found: ${businessId}`, { pollId });
          this.stopPolling(businessId);
          return;
        }

        await this.pollInstagram(business, pollId);
        await prisma.business.update({
          where: { id: businessId },
          data: { lastPolledAt: new Date() },
        });
      } catch (error) {
        logger.logError(error, { context: 'pollMessages', pollId, businessId });
      }

      logger.info(`Completed poll for business: ${businessId}`, {
        pollId,
        timeElapsed: `${Date.now() - startTime}ms`,
      });
    };

    const interval = this.basePollInterval + Math.random() * 15000;
    this.pollers.set(businessId, setInterval(poll, interval));
    await poll();
    logger.info(`Started polling for business: ${businessId}`, { interval });
  }

  async stopPolling(businessId) {
    const interval = this.pollers.get(businessId);
    if (interval) {
      clearInterval(interval);
      this.pollers.delete(businessId);
      logger.info(`Stopped polling for business: ${businessId}`);
    }
  }

  async pollInstagram(business, pollId) {
    const session = business.sessions[0];
    logger.debug('Found active Instagram session', {
      pollId,
      businessId: business.id,
      sessionId: session.id,
      expiresAt: session.expiresAt,
    });
  
    const ig = new IgApiClient();
    ig.state.generateDevice(`${business.instagramUsername}-${Math.random().toString(36).substring(2)}`);
  
    try {
      await withRetry(() => ig.state.deserialize(session.serializedCookies));
      const direct = ig.feed.directInbox();
      const threads = await direct.items();
  
      let processedCount = 0;
      for (const thread of threads.slice(0, 5)) {
        const lastMessage = thread.items[0];
        const isOutgoing = lastMessage.user_id === ig.state.cookieUserId;
        
        // Log message details
        logger.debug('Processing message', {
          pollId,
          messageId: lastMessage.item_id,
          threadId: thread.thread_id,
          userId: lastMessage.user_id,
          isOutgoing,
          messageType: lastMessage.item_type,
          timestamp: new Date(lastMessage.timestamp / 1000).toISOString(),
          textPreview: lastMessage.text?.substring(0, 100) + (lastMessage.text?.length > 100 ? '...' : '')
        });

        if (isOutgoing) {
          logger.debug('Skipping bot message', { 
            messageId: lastMessage.item_id, 
            threadId: thread.thread_id,
            userId: lastMessage.user_id,
            isOutgoing: true
          });
          continue;
        }

        // Log thread-user mapping for debugging
        const threadUsers = thread.users.map(u => ({
          userId: u.pk,
          username: u.username,
          isSelf: u.pk === ig.state.cookieUserId
        }));

        logger.debug('Processing thread', {
          pollId,
          threadId: thread.thread_id,
          threadUsers,
          isGroup: thread.is_group,
          messageCount: thread.items.length,
          lastMessageId: lastMessage.item_id,
          lastMessageFrom: lastMessage.user_id
        });
  
        // Check if the message already exists in the database
        const existingMessage = await prisma.message.findFirst({
          where: {
            businessId: business.id,
            threadId: thread.thread_id,
            messageId: lastMessage.item_id,
          },
        });
        
        if (existingMessage) {
          logger.debug('Message already processed', { 
            messageId: lastMessage.item_id, 
            threadId: thread.thread_id,
            existingMessageId: existingMessage.id
          });
          continue;
        }

        // Prepare message content - handle cases where text might be missing
        const messageContent = lastMessage.text || 
                             (lastMessage.link && lastMessage.link.text) || 
                             `[${lastMessage.item_type} message]`;

        // Create or update thread metadata
        await prisma.threadMetadata.upsert({
          where: {
            businessId_threadId: {
              businessId: business.id,
              threadId: thread.thread_id
            }
          },
          update: {
            isGroup: thread.is_group,
            users: thread.users.map(u => ({
              userId: u.pk,
              username: u.username,
              fullName: u.full_name,
              isSelf: u.pk === ig.state.cookieUserId
 })),
            lastUpdated: new Date()
          },
          create: {
            businessId: business.id,
            threadId: thread.thread_id,
            isGroup: thread.is_group,
            users: thread.users.map(u => ({
              userId: u.pk,
              username: u.username,
              fullName: u.full_name,
              isSelf: u.pk === ig.state.cookieUserId
            }))
          }
        });

        // Only process new messages
        const newMessage = await prisma.message.create({
          data: {
            businessId: business.id,
            threadId: thread.thread_id,
            messageId: lastMessage.item_id,
            content: messageContent,
            isIncoming: true,
            timestamp: new Date(lastMessage.timestamp / 1000),
            createdAt: new Date(),
            // No more metadata here, it's now in ThreadMetadata
          },
        });

        logger.debug('Created new message record', {
          messageId: newMessage.id,
          threadId: thread.thread_id,
          businessId: business.id
        });
  
        await enqueueMessage({
          businessId: business.id,
          threadId: thread.thread_id,
          messageText: lastMessage.text,
          userId: lastMessage.user_id, // Use the actual message sender's ID
          messageId: lastMessage.item_id,
          timestamp: new Date(lastMessage.timestamp / 1000).getTime(),
          chatbotId: business.chatbotId,
          platform: 'INSTAGRAM',
          threadUsers: thread.users.map(u => ({
            id: u.pk,
            username: u.username,
            fullName: u.full_name
          }))
        });
  
        this.broadcastNewMessage(business, {
          threadId: thread.thread_id,
          messageId: lastMessage.item_id,
          content: lastMessage.text,
          timestamp: new Date(lastMessage.timestamp / 1000).toISOString(),
          senderId: lastMessage.user_id, // Use the actual message sender's ID
          isIncoming: true,
          threadUsers: thread.users.map(u => ({
            id: u.pk,
            username: u.username,
            fullName: u.full_name
          }))
        }, 'INSTAGRAM', pollId);
  
        processedCount++;
      }
  
      logger.info('Completed Instagram poll', {
        pollId,
        businessId: business.id,
        businessName: business.businessName,
        messagesProcessed: processedCount,
      });
    } catch (error) {
      if (error.message.includes('login_required')) {
        logger.warn('Instagram session invalid or account may be banned', { pollId, businessId: business.id });
        await prisma.session.deleteMany({ where: { businessId: business.id, platform: 'INSTAGRAM' } });
        await prisma.business.update({ where: { id: business.id }, data: { instagramUsername: null } });
      }
      throw error;
    }
  }
  broadcastNewMessage(business, msg, platform, pollId) {
    try {
      webChatSocketService.broadcastToBusinessClients(business.chatbotId, {
        type: 'platform_message',
        data: {
          businessId: business.id,
          platform,
          threadId: msg.threadId,
          messageId: msg.messageId,
          content: msg.content,
          timestamp: msg.timestamp,
          isIncoming: true,
          sender: 'Instagram User',
        },
      });
      logger.info('Broadcasted platform message via WebSocket', { pollId, businessId: business.id, platform, threadId: msg.threadId });
    } catch (error) {
      logger.logError(error, { context: 'broadcastNewMessage', pollId, businessId: business.id, platform, threadId: msg.threadId });
    }
  }

  broadcastBotReply(business, originalMsg, reply, platform, processId) {
    try {
      webChatSocketService.broadcastToBusinessClients(business.chatbotId, {
        type: 'bot_reply',
        data: {
          businessId: business.id,
          platform,
          threadId: originalMsg.threadId,
          messageId: `bot_${Date.now()}`,
          content: reply,
          timestamp: new Date().toISOString(),
          isIncoming: false,
          sender: 'Bot',
          inReplyTo: originalMsg.messageId,
        },
      });
      logger.info('Broadcasted bot reply via WebSocket', { processId, businessId: business.id, platform, threadId: originalMsg.threadId });
    } catch (error) {
      logger.logError(error, { context: 'broadcastBotReply', processId, businessId: business.id, platform, threadId: originalMsg.threadId });
    }
  }

  async startAllPolling() {
    try {
      const activeSessions = await prisma.session.findMany({
        where: { platform: 'INSTAGRAM', expiresAt: { gt: new Date() }, serializedCookies: { not: '' } },
        select: { businessId: true },
        distinct: ['businessId'],
      });

      if (activeSessions.length === 0) {
        logger.info('No active Instagram sessions found for polling');
        return;
      }

      const businesses = await prisma.business.findMany({
        where: { id: { in: activeSessions.map(s => s.businessId) } },
      });

      for (const biz of businesses) {
        await this.startPolling(biz.id);
      }

      logger.info(`Started polling for ${businesses.length} businesses`);
    } catch (error) {
      logger.logError(error, { context: 'startAllPolling' });
      throw error;
    }
  }

  async stopAllPolling() {
    for (const businessId of this.pollers.keys()) {
      await this.stopPolling(businessId);
    }
  }
}

export async function withRetry(fn, maxRetries = 3, delay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (err.message.includes('rate limit')) {
        await new Promise(resolve => setTimeout(resolve, 60000));
      }
      if (i === maxRetries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, delay * 2 ** i));
    }
  }
}

const pollingService = new PollingService();
export { pollingService };