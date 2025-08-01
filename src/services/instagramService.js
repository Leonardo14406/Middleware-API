import { IgApiClient } from 'instagram-private-api';
import redis from '../config/redis.js';
import prisma from '../config/db.js';
import { logger } from '../utils/logger.js';
import { withRetry } from './pollingService.js';

async function cacheKey(businessId) {
  return `ig-client:${businessId}`;
}

async function loginInstagram(username, password, businessId) {
  const ig = new IgApiClient();
  ig.state.generateDevice(username);

  try {
    const auth = await withRetry(() => ig.account.login(username, password));
    const serialized = await ig.state.serialize();
    delete serialized.constants;

    if (businessId) {
      await prisma.session.upsert({
        where: { businessId_platform: { businessId, platform: 'INSTAGRAM' } },
        update: { serializedCookies: JSON.stringify(serialized), updatedAt: new Date(), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
        create: { businessId, platform: 'INSTAGRAM', serializedCookies: JSON.stringify(serialized), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
      });
      logger.info('Instagram session saved for polling', { businessId });
    }

    return { ig, serialized: JSON.stringify(serialized) };
  } catch (err) {
    logger.logError(err, { context: 'loginInstagram', username });
    throw new Error('Invalid Instagram credentials');
  }
}

async function restoreSession(serializedCookies) {
  const ig = new IgApiClient();
  await withRetry(() => ig.state.deserialize(JSON.parse(serializedCookies)));
  return ig;
}

async function ensureClient(businessId, serializedCookies) {
  const key = await cacheKey(businessId);

  try {
    const cachedSession = await redis.get(key);
    if (cachedSession) {
      try {
        return await restoreSession(cachedSession);
      } catch {
        logger.warn('Invalid session in Redis, restoring from DB', { businessId });
        await redis.del(key);
      }
    }
  } catch (redisErr) {
    logger.warn('Redis unavailable, falling back to DB session', { businessId, error: redisErr.message });
  }

  const ig = await restoreSession(serializedCookies);
  try {
    await redis.set(key, serializedCookies, 'EX', 3600);
  } catch (redisErr) {
    logger.warn('Failed to cache session in Redis', { businessId, error: redisErr.message });
  }

  return ig;
}

async function fetchRecentMessages(ig, limit = 20) {
  try {
    const direct = ig.feed.directInbox();
    const threads = await direct.items();
    const messages = [];

    for (const thread of threads.slice(0, 5)) {
      const lastMessage = thread.items[0];
      if (!lastMessage || lastMessage.item_type !== 'text' || lastMessage.user_id === ig.state.cookieUserId) continue;

      messages.push({
        threadId: thread.thread_id,
        messageId: lastMessage.item_id,
        content: lastMessage.text,
        timestamp: new Date(lastMessage.timestamp / 1000).toISOString(),
        isIncoming: true,
        senderId: lastMessage.user_id,
      });
    }

    return messages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  } catch (err) {
    logger.logError(err, { context: 'fetchRecentMessages' });
    throw new Error('Failed to fetch Instagram messages');
  }
}

async function sendMessage(ig, threadId, text) {
  const requestId = `ig_send_${Date.now()}`;
  const startTime = Date.now();

  logger.info('Sending message to Instagram', {
    requestId,
    threadId,
    textLength: text.length,
    textPreview: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
  });

  try {
    const thread = ig.entity.directThread(threadId);
    const result = await withRetry(() => thread.broadcastText(text));
    logger.info('Successfully sent message to Instagram', {
      requestId,
      threadId,
      timeElapsed: `${Date.now() - startTime}ms`,
    });
    return result;
  } catch (err) {
    logger.logError(err, { context: 'sendMessage', requestId, threadId });
    throw new Error('Failed to send Instagram message');
  }
}

export { loginInstagram, restoreSession, ensureClient, fetchRecentMessages, sendMessage };
export default { loginInstagram, restoreSession, ensureClient, fetchRecentMessages, sendMessage };