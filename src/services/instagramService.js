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
  ig.state.generateDevice(`${username}-${Math.random().toString(36).substring(2)}`);

  const requestId = `ig_login_${Date.now()}`;
  try {
    const auth = await withRetry(() => ig.account.login(username, password), 2, 2000);
    const serialized = await ig.state.serialize();
    delete serialized.constants;

    if (businessId) {
      await prisma.session.upsert({
        where: { businessId_platform: { businessId, platform: 'INSTAGRAM' } },
        update: {
          serializedCookies: JSON.stringify(serialized),
          updatedAt: new Date(),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
        create: {
          businessId,
          platform: 'INSTAGRAM',
          serializedCookies: JSON.stringify(serialized),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      // Cache in Redis with retry
      const key = await cacheKey(businessId);
      try {
        await withRetry(() => redis.set(key, JSON.stringify(serialized), 'EX', 3600), 2, 1000);
        logger.info('Instagram session cached in Redis', { businessId, requestId });
      } catch (redisErr) {
        logger.warn('Failed to cache session in Redis', { businessId, requestId, error: redisErr.message });
      }

      logger.info('Instagram session saved for polling', { businessId, requestId });
    }

    return { ig, serialized: JSON.stringify(serialized) };
  } catch (err) {
    const errorDetails = {
      context: 'loginInstagram',
      requestId,
      username,
      error: err.message,
      stack: err.stack,
      apiError: err.response?.body?.message || 'No API response',
    };
    logger.error('Instagram login failed', errorDetails);

    if (err.message.includes('rate limit')) {
      throw new Error('Instagram rate limit exceeded');
    } else if (err.message.includes('checkpoint_required')) {
      throw new Error('Instagram requires checkpoint verification');
    } else if (err.message.includes('invalid_credentials')) {
      throw new Error('Invalid Instagram username or password');
    }
    throw new Error('Failed to login to Instagram');
  }
}

async function restoreSession(serializedCookies) {
  const ig = new IgApiClient();
  await withRetry(() => ig.state.deserialize(JSON.parse(serializedCookies)), 2, 1000);
  return ig;
}

async function ensureClient(businessId, serializedCookies) {
  const key = await cacheKey(businessId);
  const requestId = `ig_restore_${Date.now()}`;

  try {
    const cachedSession = await withRetry(() => redis.get(key), 2, 1000);
    if (cachedSession) {
      try {
        const ig = await restoreSession(cachedSession);
        logger.debug('Restored Instagram session from Redis', { businessId, requestId });
        return ig;
      } catch (err) {
        logger.warn('Invalid session in Redis, restoring from DB', { businessId, requestId, error: err.message });
        await redis.del(key);
      }
    }
  } catch (redisErr) {
    logger.warn('Redis unavailable, falling back to DB session', { businessId, requestId, error: redisErr.message });
  }

  const ig = await restoreSession(serializedCookies);
  try {
    await withRetry(() => redis.set(key, serializedCookies, 'EX', 3600), 2, 1000);
    logger.debug('Cached Instagram session in Redis', { businessId, requestId });
  } catch (redisErr) {
    logger.warn('Failed to cache session in Redis', { businessId, requestId, error: redisErr.message });
  }

  return ig;
}

async function fetchRecentMessages(ig, limit = parseInt(process.env.IG_THREAD_LIMIT || '10')) {
  const requestId = `ig_fetch_${Date.now()}`;
  try {
    // Check global rate limit (shared with pollingService)
    if (typeof pollingService !== 'undefined') {
      await pollingService.checkRateLimit(true);
    }

    const direct = ig.feed.directInbox();
    let threads = await direct.items();
    threads = threads.slice(0, limit);
    const messages = [];

    for (const thread of threads) {
      const lastMessage = thread.items[0];
      if (!lastMessage || lastMessage.item_type !== 'text' || lastMessage.user_id === ig.state.cookieUserId) continue;

      messages.push({
        threadId: thread.thread_id,
        messageId: lastMessage.item_id || `temp_${lastMessage.timestamp}`,
        content: lastMessage.text,
        timestamp: new Date(Math.floor(lastMessage.timestamp / 1000)).toISOString(), // Preserve microsecond precision
        isIncoming: true,
        senderId: lastMessage.user_id,
      });
    }

    const sortedMessages = messages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    logger.info('Fetched recent Instagram messages', {
      requestId,
      messageCount: sortedMessages.length,
      threadCount: threads.length,
      limit,
    });
    return sortedMessages;
  } catch (err) {
    logger.error('Failed to fetch Instagram messages', {
      context: 'fetchRecentMessages',
      requestId,
      error: err.message,
      stack: err.stack,
      apiError: err.response?.body?.message || 'No API response',
    });
    throw new Error(`Failed to fetch Instagram messages: ${err.message}`);
  }
}

async function sendMessage(ig, threadId, text, targetUserId = null, requireMention = false) {
  const requestId = `ig_send_${Date.now()}`;
  const startTime = Date.now();
  const logContext = {
    requestId,
    threadId,
    targetUserId,
    currentUserId: ig.state.cookieUserId,
    textLength: text.length,
    textPreview: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
  };

  logger.info('Sending message to Instagram', logContext);

  try {
    // Check global rate limit
    if (typeof pollingService !== 'undefined') {
      await pollingService.checkRateLimit(true);
    }

    const direct = ig.feed.directInbox();
    const threads = await direct.items();
    const targetThread = threads.find(t => t.thread_id === threadId);

    if (!targetThread) {
      logger.error('Thread not found', logContext);
      throw new Error(`Thread ${threadId} not found`);
    }

    // Log thread details for debugging
    const threadUsers = targetThread.users.map(u => ({
      userId: u.pk,
      username: u.username,
      fullName: u.full_name,
      isSelf: u.pk === ig.state.cookieUserId,
    }));

    const threadInfo = {
      ...logContext,
      threadUsers,
      isGroup: targetThread.is_group,
      threadV2Id: targetThread.thread_v2_id,
      lastActivity: targetThread.last_activity ? new Date(Math.floor(targetThread.last_activity / 1000)).toISOString() : null,
      messageCount: targetThread.items?.length || 0,
      hasOlder: targetThread.has_older,
      hasNewer: targetThread.has_newer,
      isPin: targetThread.is_pin,
      isSpam: targetThread.is_spam,
      isCloseFriends: targetThread.is_close_friend_thread,
      isVerified: targetThread.users.some(u => u.is_verified),
    };
    logger.debug('Thread details', threadInfo);

    // Validate thread-user mapping if targetUserId is provided
    if (targetUserId) {
      const isValidThread = targetThread.users.some(user => user.pk === targetUserId);
      if (!isValidThread) {
        throw new Error(`Thread ${threadId} does not belong to user ${targetUserId}`);
      }
    }

    // Check for bot mention in group chats if required
    if (requireMention && targetThread.is_group) {
      const lastMessage = targetThread.items[0];
      if (!lastMessage?.text?.includes(`@${ig.state.cookieUsername}`)) {
        logger.debug('Skipping group chat response: bot not mentioned', { requestId, threadId });
        return { skipped: true, reason: 'Bot not mentioned in group chat' };
      }
    }

    const thread = ig.entity.directThread(threadId);
    const result = await withRetry(() => thread.broadcastText(text), 3, 2000);

    logger.info('Successfully sent message to Instagram', {
      requestId,
      threadId,
      targetUserId,
      timeElapsed: `${Date.now() - startTime}ms`,
      threadUserCount: targetThread.users.length,
      isGroup: targetThread.is_group,
    });
    return result;
  } catch (err) {
    logger.error('Failed to send Instagram message', {
      context: 'sendMessage',
      requestId,
      threadId,
      error: err.message,
      stack: err.stack,
      apiError: err.response?.body?.message || 'No API response',
    });
    throw new Error(`Failed to send Instagram message: ${err.message}`);
  }
}

export { loginInstagram, restoreSession, ensureClient, fetchRecentMessages, sendMessage };
export default { loginInstagram, restoreSession, ensureClient, fetchRecentMessages, sendMessage };