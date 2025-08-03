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

async function sendMessage(ig, threadId, text, targetUserId = null) {
  const requestId = `ig_send_${Date.now()}`;
  const startTime = Date.now();
  const logContext = { 
    requestId, 
    threadId, 
    targetUserId,
    currentUserId: ig.state.cookieUserId,
    textLength: text.length,
    textPreview: text.substring(0, 100) + (text.length > 100 ? '...' : '')
  };

  logger.info('Sending message to Instagram', logContext);

  try {
    // Verify thread exists and get its details
    const direct = ig.feed.directInbox();
    const threads = await direct.items();
    const targetThread = threads.find(t => t.thread_id === threadId);

    logger.debug('Thread search results', {
      ...logContext,
      totalThreads: threads.length,
      foundThread: !!targetThread,
      threadIds: threads.map(t => t.thread_id)
    });

    if (!targetThread) {
      logger.error('Thread not found', logContext);
      throw new Error(`Thread ${threadId} not found`);
    }

    // Log thread-user mapping for debugging
    const threadUsers = targetThread.users.map(u => ({
      userId: u.pk,
      username: u.username,
      fullName: u.full_name,
      isSelf: u.pk === ig.state.cookieUserId
    }));

    const threadInfo = {
      ...logContext,
      threadUsers,
      isGroup: targetThread.is_group,
      threadV2Id: targetThread.thread_v2_id,
      lastActivity: targetThread.last_activity ? new Date(targetThread.last_activity / 1000).toISOString() : null,
      messageCount: targetThread.items?.length || 0,
      hasOlder: targetThread.has_older,
      hasNewer: targetThread.has_newer,
      isPin: targetThread.is_pin,
      isSpam: targetThread.is_spam,
      isCloseFriends: targetThread.is_close_friend_thread,
      isVerified: targetThread.users.some(u => u.is_verified)
    };

    logger.debug('Thread details', threadInfo);

    // Validate thread-user mapping if targetUserId is provided
    if (targetUserId) {
      const isValidThread = targetThread.users.some(user => user.pk === targetUserId);
      if (!isValidThread) {
        throw new Error(`Thread ${threadId} does not belong to user ${targetUserId}`);
      }
    }

    const thread = ig.entity.directThread(threadId);
    const result = await withRetry(() => thread.broadcastText(text));
    
    logger.info('Successfully sent message to Instagram', {
      requestId,
      threadId,
      targetUserId,
      timeElapsed: `${Date.now() - startTime}ms`,
      threadUserCount: targetThread.users.length,
      isGroup: targetThread.is_group
    });
    return result;
  } catch (err) {
    logger.logError(err, { context: 'sendMessage', requestId, threadId });
    throw new Error('Failed to send Instagram message');
  }
}

export { loginInstagram, restoreSession, ensureClient, fetchRecentMessages, sendMessage };
export default { loginInstagram, restoreSession, ensureClient, fetchRecentMessages, sendMessage };