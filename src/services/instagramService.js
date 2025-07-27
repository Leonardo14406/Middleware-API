import { IgApiClient } from "instagram-private-api";
import redis from "../config/redis.js";
import { logger } from "../utils/logger.js";

async function cacheKey(businessId) {
  return `ig-client:${businessId}`;
}

async function loginInstagram(username, password) {
  const ig = new IgApiClient();
  ig.state.generateDevice(username);

  await ig.account.login(username, password);
  const serialized = await ig.state.serialize();
  delete serialized.constants;

  return {
    ig,
    serialized: JSON.stringify(serialized),
  };
}

async function restoreSession(serializedCookies) {
  const ig = new IgApiClient();
  await ig.state.deserialize(JSON.parse(serializedCookies));
  return ig;
}

async function ensureClient(businessId, serializedCookies) {
  const key = await cacheKey(businessId);

  try {
    const cachedSession = await redis.get(key);
    if (cachedSession) {
      try {
        return await restoreSession(cachedSession);
      } catch (err) {
        logger.warn("Invalid session in Redis, restoring from DB", { businessId });
        await redis.del(key); // Clear bad session
      }
    }
  } catch (redisErr) {
    logger.warn("Redis unavailable, falling back to DB session", {
      businessId,
      error: redisErr.message,
    });
  }

  // Fallback to DB session
  const ig = await restoreSession(serializedCookies);

  try {
    await redis.set(key, serializedCookies, "EX", 3600); // Cache for 1 hour
  } catch (redisSetErr) {
    logger.warn("Failed to cache session in Redis", {
      businessId,
      error: redisSetErr.message,
    });
  }

  return ig;
}

async function fetchRecentMessages(ig, limit = 20) {
  const inbox = ig.feed.directInbox();
  const threads = await inbox.items();
  const messages = [];

  for (const thread of threads.slice(0, 5)) {
    const threadFeed = ig.feed.directThread({ thread_id: thread.thread_id });
    const threadMessages = await threadFeed.items();

    for (const msg of threadMessages.slice(0, limit / 5)) {
      messages.push({
        threadId: thread.thread_id,
        messageId: msg.item_id,
        content: msg.text || "[Media]",
        timestamp: new Date(msg.timestamp / 1000),
        isIncoming: msg.user_id !== ig.state.cookieUserId,
      });
    }
  }

  return messages.sort((a, b) => b.timestamp - a.timestamp);
}

async function sendMessage(ig, threadId, text) {
  const thread = ig.entity.directThread(threadId);
  await thread.broadcastText(text);
}

// Export all functions as named exports
export {
  loginInstagram,
  restoreSession,
  ensureClient,
  fetchRecentMessages,
  sendMessage
};

// Also provide a default export with all functions
const instagramService = {
  loginInstagram,
  restoreSession,
  ensureClient,
  fetchRecentMessages,
  sendMessage
};

export default instagramService;
