import { IgApiClient } from 'instagram-private-api';
import prisma from '../config/db.js';
import { logger } from '../utils/logger.js';
import { enqueueMessage } from './queueService.js';
import { webChatSocketService } from './webChatSocketService.js';
import { ensureClient, loginInstagram } from './instagramService.js';

class PollingService {
  constructor() {
    this.pollers = new Map();
    this.lastPolledThreads = new Map(); // Initialize to prevent undefined errors
    this.threadCursor = 0;
    this.globalApiCalls = []; // Track API calls across all businesses
    this.CONFIG = {
      POLL_INTERVAL: 10000, // Increased to 10 seconds
      MAX_THREADS_PER_BATCH: 10,
      MESSAGES_PER_MINUTE: 30,
      THREAD_COOLDOWN: 30000,
      USER_MESSAGE_TIMEOUT: 300000, // 5 minutes
      BATCH_DELAY_MS: 1000,
      MAX_CONCURRENT_DB_OPS: 5,
      RATE_LIMIT_WINDOW_MS: 60000,
    };
    this.rateLimitWindow = [];
    this.dbConnectionPool = [];
    this.isProcessing = false;
    this.initDbConnectionPool();
  }

  async initDbConnectionPool() {
    for (let i = 0; i < this.CONFIG.MAX_CONCURRENT_DB_OPS; i++) {
      this.dbConnectionPool.push({
        id: i,
        inUse: false,
        lastUsed: 0,
      });
    }
  }

  async getDbConnection() {
    const startTime = Date.now();
    const timeout = 10000;
    while (Date.now() - startTime < timeout) {
      const available = this.dbConnectionPool.find((conn) => !conn.inUse);
      if (available) {
        available.inUse = true;
        available.lastUsed = Date.now();
        return available;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Could not acquire DB connection within timeout');
  }

  releaseDbConnection(conn) {
    if (conn) {
      conn.inUse = false;
    }
  }

  async checkRateLimit(isGlobal = false) {
    const now = Date.now();
    const window = isGlobal ? this.globalApiCalls : this.rateLimitWindow;
    const limit = this.CONFIG.MESSAGES_PER_MINUTE * (isGlobal ? 5 : 0.9);
    
    if (isGlobal) {
      this.globalApiCalls = this.globalApiCalls.filter(
        (ts) => now - ts < this.CONFIG.RATE_LIMIT_WINDOW_MS
      );
    } else {
      this.rateLimitWindow = this.rateLimitWindow.filter(
        (ts) => now - ts < this.CONFIG.RATE_LIMIT_WINDOW_MS
      );
    }

    if (window.length >= limit) {
      const timeToWait = (window[0] + this.CONFIG.RATE_LIMIT_WINDOW_MS) - now;
      if (timeToWait > 0) {
        logger.info(`Rate limit approached (${isGlobal ? 'global' : 'local'}), pausing for ${timeToWait}ms`);
        await new Promise((resolve) => setTimeout(resolve, timeToWait));
      }
    }
    if (isGlobal) {
      this.globalApiCalls.push(now);
    } else {
      this.rateLimitWindow.push(now);
    }
  }

  async processInBatches(items, processFn, batchSize = this.CONFIG.MAX_THREADS_PER_BATCH) {
    const results = [];
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((item) => this.withRateLimit(() => processFn(item)))
      );
      results.push(...batchResults);
      if (i + batchSize < items.length) {
        await new Promise((resolve) => setTimeout(resolve, this.CONFIG.BATCH_DELAY_MS));
      }
    }
    return results;
  }

  async withRateLimit(fn) {
    await this.checkRateLimit();
    const result = await fn();
    return result;
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
        logger.error('Polling error', { context: 'pollMessages', pollId, businessId, error: error.message, stack: error.stack });
      }

      logger.info(`Completed poll for business: ${businessId}`, {
        pollId,
        timeElapsed: `${Date.now() - startTime}ms`,
      });
    };

    const interval = this.CONFIG.POLL_INTERVAL + Math.random() * 1000; // Reduced jitter for stability
    this.pollers.set(businessId, setInterval(poll, interval));
    setTimeout(() => poll(), 1000); // Reduced initial delay
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

  shouldProcessThread(thread, botUserId) {
    if (!thread?.items?.length) {
      return { shouldProcess: false, lastUserMessage: null };
    }

    const lastUserMessage = thread.items.find(
      (msg) => msg && msg.item_type === 'text' && msg.user_id && msg.user_id.toString() !== botUserId.toString()
    );

    if (!lastUserMessage) {
      return { shouldProcess: false, lastUserMessage: null };
    }

    const messageTime = new Date(lastUserMessage.timestamp / 1000);
    const messageAge = Date.now() - messageTime.getTime();
    const isRecent = messageAge <= this.CONFIG.USER_MESSAGE_TIMEOUT;

    return {
      shouldProcess: isRecent,
      lastUserMessage: isRecent ? lastUserMessage : null,
    };
  }

  async pollInstagram(business, pollId) {
    if (this.isProcessing) {
      logger.debug('Skipping poll - already processing', { businessId: business.id, pollId });
      return { success: false, message: 'Already processing' };
    }

    this.isProcessing = true;
    const startTime = Date.now();
    let dbConnection;
    let processedCount = 0;

    const cleanup = async () => {
      this.releaseDbConnection(dbConnection);
      this.isProcessing = false;
      logger.debug('Polling completed', {
        businessId: business.id,
        pollId,
        durationMs: Date.now() - startTime,
        processedCount,
      });
    };

    try {
      if (!business.instagramUsername) {
        logger.debug('No Instagram username configured', { businessId: business.id });
        return { success: false, message: 'No Instagram username configured' };
      }

      dbConnection = await this.getDbConnection();
      const session = await prisma.session.findFirst({
        where: { businessId: business.id, platform: 'INSTAGRAM', expiresAt: { gt: new Date() } },
      });

      if (!session) {
        logger.warn('No active Instagram session found', { businessId: business.id });
        return { success: false, message: 'No active Instagram session' };
      }

      let ig;
      try {
        ig = await ensureClient(business.id, session.serializedCookies);
      } catch (error) {
        if (error.message.includes('login_required') && business.instagramPassword) {
          logger.warn('Session expired, attempting re-login', { businessId: business.id });
          const { ig: newIg } = await loginInstagram(business.instagramUsername, business.instagramPassword, business.id);
          ig = newIg;
        } else {
          throw error;
        }
      }

      await this.checkRateLimit(true); // Global rate limit check
      const direct = ig.feed.directInbox();
      let threads;
      try {
        threads = await direct.items();
      } catch (error) {
        logger.error('Error fetching Instagram threads', {
          error: error.message,
          businessId: business.id,
          stack: error.stack,
        });
        return { success: false, message: 'Failed to fetch threads' };
      }

      // Cycle through threads using cursor
      const startIndex = this.threadCursor % Math.max(1, threads.length);
      threads = [...threads.slice(startIndex), ...threads.slice(0, startIndex)];
      threads.sort((a, b) => {
        const timeA = a.items[0]?.timestamp || 0;
        const timeB = b.items[0]?.timestamp || 0;
        return timeB - timeA;
      });

      const eligibleThreads = [];
      for (const thread of threads) {
        const threadRecord = await prisma.threadMetadata.findFirst({
          where: { businessId: business.id, threadId: thread.thread_id },
        });
        const lastPolled = threadRecord?.lastUpdated || new Date(0);
        const lastPolledMap = this.lastPolledThreads.get(thread.thread_id) || 0;
        const isOnCooldown = Date.now() - lastPolledMap <= this.CONFIG.THREAD_COOLDOWN;

        if (isOnCooldown) {
          logger.debug('Skipping thread on cooldown', {
            threadId: thread.thread_id,
            lastPolled: new Date(lastPolledMap).toISOString(),
            cooldown: this.CONFIG.THREAD_COOLDOWN,
          });
          continue;
        }

        const { shouldProcess, lastUserMessage } = this.shouldProcessThread(thread, ig.state.cookieUserId);
        if (shouldProcess && lastUserMessage) {
          const messageTimestamp = new Date(lastUserMessage.timestamp / 1000);
          if (messageTimestamp <= lastPolled) {
            logger.debug('Skipping old message', {
              threadId: thread.thread_id,
              messageId: lastUserMessage.item_id,
              messageTimestamp: messageTimestamp.toISOString(),
              lastPolled: lastPolled.toISOString(),
            });
            continue;
          }
          eligibleThreads.push({ thread, lastUserMessage });
        }

        if (eligibleThreads.length >= this.CONFIG.MAX_THREADS_PER_BATCH) {
          break;
        }
      }

      this.threadCursor = (this.threadCursor + eligibleThreads.length) % Math.max(1, threads.length);
      logger.debug(`Processing ${eligibleThreads.length} eligible threads`, {
        totalThreads: threads.length,
        eligibleCount: eligibleThreads.length,
        businessId: business.id,
        pollId,
      });

      const processThread = async ({ thread, lastUserMessage }) => {
        let dbConn;
        try {
          dbConn = await this.getDbConnection();
          const messageTimestamp = new Date(lastUserMessage.timestamp / 1000);

          const existingMessage = await prisma.message.findFirst({
            where: {
              businessId: business.id,
              threadId: thread.thread_id,
              messageId: lastUserMessage.item_id || `temp_${messageTimestamp.getTime()}`,
            },
          });

          if (existingMessage) {
            logger.debug('Message already processed', {
              threadId: thread.thread_id,
              messageId: lastUserMessage.item_id,
            });
            return false;
          }

          const messageId = lastUserMessage.item_id || `msg_${Date.now()}_${Math.random().toString(36).substring(2)}`;
          if (!lastUserMessage.item_id) {
            logger.warn('Message missing item_id, using generated ID', { messageId, threadId: thread.thread_id });
          }

          await prisma.message.create({
            data: {
              businessId: business.id,
              threadId: thread.thread_id,
              messageId,
              userId: String(lastUserMessage.user_id || 'unknown_user'),
              content: lastUserMessage.text || 'Media message',
              isIncoming: true,
              timestamp: messageTimestamp,
              createdAt: new Date(),
            },
          });

          await enqueueMessage({
            businessId: business.id,
            threadId: thread.thread_id,
            messageText: lastUserMessage.text,
            userId: lastUserMessage.user_id,
            messageId,
            timestamp: messageTimestamp.getTime(),
            chatbotId: business.chatbotId,
            platform: 'INSTAGRAM',
          });

          await prisma.threadMetadata.upsert({
            where: {
              businessId_threadId: {
                businessId: business.id,
                threadId: thread.thread_id,
              },
            },
            update: {
              lastUpdated: messageTimestamp,
              updatedAt: new Date(),
            },
            create: {
              businessId: business.id,
              threadId: thread.thread_id,
              lastUpdated: messageTimestamp,
              users: JSON.stringify(thread.users || []),
            },
          });

          this.broadcastNewMessage(
            business,
            {
              threadId: thread.thread_id,
              messageId,
              content: lastUserMessage.text,
              timestamp: messageTimestamp.toISOString(),
              senderId: lastUserMessage.user_id,
              isIncoming: true,
            },
            'INSTAGRAM',
            pollId
          );

          this.lastPolledThreads.set(thread.thread_id, Date.now());
          return true;
        } catch (error) {
          logger.error('Error processing message', {
            error: error.message,
            threadId: thread.thread_id,
            messageId: lastUserMessage?.item_id,
            stack: error.stack,
          });
          return false;
        } finally {
          this.releaseDbConnection(dbConn);
        }
      };

      const results = await this.processInBatches(eligibleThreads, processThread);
      processedCount = results.filter(Boolean).length;

      logger.info('Completed Instagram poll', {
        pollId,
        businessId: business.id,
        businessName: business.businessName,
        messagesProcessed: processedCount,
      });
      return { success: true, processedCount };
    } catch (error) {
      if (error.message.includes('login_required')) {
        logger.warn('Instagram session invalid or account may be banned', {
          pollId,
          businessId: business.id,
          error: error.message,
        });
        await prisma.session.deleteMany({
          where: { businessId: business.id, platform: 'INSTAGRAM' },
        });
        await prisma.business.update({
          where: { id: business.id },
          data: { instagramUsername: null },
        });
      } else {
        logger.error('Error in Instagram polling', {
          error: error.message,
          stack: error.stack,
          businessId: business.id,
          pollId,
        });
      }
      return { success: false, message: 'Internal server error' };
    } finally {
      await cleanup();
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
          senderId: msg.senderId,
          sender: 'Instagram User',
        },
      });
      logger.info('Broadcasted platform message via WebSocket', {
        pollId,
        businessId: business.id,
        platform,
        threadId: msg.threadId,
        senderId: msg.senderId,
      });
    } catch (error) {
      logger.error('Broadcast error', {
        context: 'broadcastNewMessage',
        pollId,
        businessId: business.id,
        platform,
        threadId: msg.threadId,
        error: error.message,
        stack: error.stack,
      });
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
          senderId: business.instagramUserId || 'bot',
          inReplyTo: originalMsg.messageId,
          userId: originalMsg.userId,
        },
      });
      logger.info('Broadcasted bot reply via WebSocket', {
        processId,
        businessId: business.id,
        platform,
        threadId: originalMsg.threadId,
        userId: originalMsg.userId,
      });
    } catch (error) {
      logger.error('Broadcast error', {
        context: 'broadcastBotReply',
        processId,
        businessId: business.id,
        platform,
        threadId: originalMsg.threadId,
        error: error.message,
        stack: error.stack,
      });
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
        where: { id: { in: activeSessions.map((s) => s.businessId) } },
      });

      for (const biz of businesses) {
        await this.startPolling(biz.id);
      }

      logger.info(`Started polling for ${businesses.length} businesses`);
    } catch (error) {
      logger.error('Error starting all polling', { context: 'startAllPolling', error: error.message, stack: error.stack });
      throw error;
    }
  }

  async stopAllPolling() {
    for (const businessId of this.pollers.keys()) {
      await this.stopPolling(businessId);
    }
    logger.info('Stopped all polling');
  }
}

export async function withRetry(fn, maxRetries = 3, delay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      logger.warn('Retry attempt failed', { attempt: i + 1, maxRetries, error: err.message });
      if (err.message.includes('rate limit')) {
        await new Promise((resolve) => setTimeout(resolve, 60000));
      }
      if (i === maxRetries - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, delay * 2 ** i));
    }
  }
}

const pollingService = new PollingService();
export { pollingService };