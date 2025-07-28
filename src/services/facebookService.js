import login from "facebook-chat-api";
import redis from "../config/redis.js";
import { logger } from "../utils/logger.js";

async function cacheKey(businessId) {
  return `fb-client:${businessId}`;
}

async function loginFacebook(email, password) {
  return new Promise((resolve, reject) => {
    login({ email, password }, (err, api) => {
      if (err) return reject(err);

      // Remove sensitive or huge fields before storing
      const appState = JSON.stringify(api.getAppState());

      resolve({
        api,
        serialized: appState,
      });
    });
  });
}

async function restoreSession(serializedCookies) {
  return new Promise((resolve, reject) => {
    login({ appState: JSON.parse(serializedCookies) }, (err, api) => {
      if (err) return reject(err);
      resolve(api);
    });
  });
}

async function ensureClient(businessId, serializedCookies) {
  const key = await cacheKey(businessId);

  try {
    const cachedSession = await redis.get(key);
    if (cachedSession) {
      try {
        return await restoreSession(cachedSession);
      } catch (err) {
        logger.warn("Invalid session in Redis, restoring from DB", {
          businessId,
        });
        await redis.del(key);
      }
    }
  } catch (redisErr) {
    logger.warn("Redis unavailable, falling back to DB session", {
      businessId,
      error: redisErr.message,
    });
  }

  const api = await restoreSession(serializedCookies);

  try {
    await redis.set(key, serializedCookies, "EX", 3600); // 1 hour cache
  } catch (err) {
    logger.warn("Failed to cache session in Redis", {
      businessId,
      error: err.message,
    });
  }

  return api;
}

async function fetchRecentMessages(api, limit = 20) {
  return new Promise((resolve, reject) => {
    api.getThreadList(0, limit, "inbox", (err, threads) => {
      if (err) return reject(err);

      const messages = [];
      let count = 0;

      const fetchEach = threads.slice(0, 5).map(
        (thread) =>
          new Promise((res, rej) => {
            api.getThreadHistory(
              thread.threadID,
              limit / 5,
              undefined,
              (err, threadMessages) => {
                if (err) return rej(err);

                threadMessages.forEach((msg) => {
                  messages.push({
                    threadId: thread.threadID,
                    messageId: msg.messageID,
                    content: msg.body || "[Media]",
                    timestamp: new Date(msg.timestamp),
                    isIncoming: msg.senderID !== api.getCurrentUserID(),
                  });
                });

                count++;
                res();
              },
            );
          }),
      );

      Promise.all(fetchEach)
        .then(() => resolve(messages.sort((a, b) => b.timestamp - a.timestamp)))
        .catch(reject);
    });
  });
}

async function sendMessage(api, threadId, text) {
  return new Promise((resolve, reject) => {
    api.sendMessage(text, threadId, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

// Exporting like your Instagram version
export {
  loginFacebook,
  restoreSession,
  ensureClient,
  fetchRecentMessages,
  sendMessage,
};

const facebookService = {
  loginFacebook,
  restoreSession,
  ensureClient,
  fetchRecentMessages,
  sendMessage,
};

export default facebookService;
