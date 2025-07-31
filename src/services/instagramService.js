import { IgApiClient } from "instagram-private-api";
import redis from "../config/redis.js";
import { logger } from "../utils/logger.js";
import { webChatSocketService } from "./webChatSocketService.js";

async function cacheKey(businessId) {
  return `ig-client:${businessId}`;
}

async function loginInstagram(username, password, businessId) {
  const ig = new IgApiClient();
  ig.state.generateDevice(username);

  await ig.account.login(username, password);
  const serialized = await ig.state.serialize();
  delete serialized.constants;

  // Save session to DB if businessId is provided
  if (businessId) {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    await prisma.session.upsert({
      where: {
        businessId_platform: {
          businessId,
          platform: "INSTAGRAM"
        }
      },
      update: {
        serializedCookies: JSON.stringify(serialized),
        updatedAt: new Date()
      },
      create: {
        businessId,
        platform: "INSTAGRAM",
        serializedCookies: JSON.stringify(serialized)
      }
    });
    logger.info("Instagram session saved for polling", { businessId });
  }

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
      } catch {
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
  const requestId = `ig_send_${Date.now()}`;
  const startTime = Date.now();
  logger.info('Sending message to Instagram', {
    requestId,
    threadId,
    textLength: text.length,
    textPreview: text.substring(0, 100) + (text.length > 100 ? '...' : '')
  });

  try {
    const thread = ig.entity.directThread(threadId);
    logger.debug('Created thread instance', {
      requestId,
      threadId,
      threadType: thread.constructor?.name
    });

    const result = await thread.broadcastText(text);
    logger.info('Successfully sent message to Instagram', {
      requestId,
      threadId,
      result: result ? JSON.stringify(result) : 'No result',
      timeElapsed: `${Date.now() - startTime}ms`
    });
    return result;
  } catch (error) {
    logger.error('Failed to send message to Instagram', {
      requestId,
      threadId,
      error: error.message,
      stack: error.stack,
      timeElapsed: `${Date.now() - startTime}ms`
    });
    throw error;
  }
}

// Process a single Instagram webhook event with AI and WebSocket
export async function processInstagramEvent(webhookEvent) {
  try {
    const senderId = webhookEvent?.sender?.id;
    const messageText = webhookEvent?.message?.text;
    if (!senderId || !messageText) {
      logger.info("Skipping Instagram event - missing sender or text", {
        hasSender: !!senderId,
        hasText: !!messageText
      });
      return;
    }

    // const businessId = req.business?.businessId;
    // if (!businessId) {
    //   logger.error("No businessId found in authenticated request");
    //   return res.status(401).json({ error: "Unauthorized: businessId missing" });
    // }
    const businessId = process.env.BUSINESS_ID
    const business = await checkBusinessExists(businessId);

    webChatSocketService.broadcastToBusinessClients(business.chatbotId, {
      type: 'instagram_message_received',
      data: {
        platform: 'instagram',
        senderId,
        userMessage: messageText,
        timestamp: new Date()
      }
    });
    const platformMessage = {
      content: messageText,
      threadId: senderId,
      email: `instagram_${senderId}@business.com`,
      timestamp: new Date()
    };
    const aiResponse = await webChatSocketService.forwardPlatformMessageToGenistudio(
      chatbotId,
      platformMessage,
      'instagram'
    );
    logger.info("AI Response generated for Instagram", {
      senderId: senderId ? senderId.substring(0, 10) + "..." : "unknown",
      chatbotId,
      responseLength: aiResponse ? aiResponse.length : 0
    });
    if (aiResponse) {
      const { PrismaClient } = await import("@prisma/client");
      const prisma = new PrismaClient();
      const session = await prisma.session.findFirst({
        where: { businessId, platform: "INSTAGRAM" }
      });
      if (session && session.serializedCookies) {
        const ig = await restoreSession(session.serializedCookies);
        await sendMessage(ig, senderId, aiResponse);
      } else {
        logger.warn("No Instagram session found for business, cannot send reply", { businessId });
      }
    }
    return aiResponse;
  } catch (error) {
    logger.error("Error processing Instagram webhook event", {
      error: error && error.message ? error.message : String(error)
    });
    return null;
  }
}

export {
  loginInstagram,
  restoreSession,
  ensureClient,
  fetchRecentMessages,
  sendMessage,
};

const instagramService = {
  loginInstagram,
  restoreSession,
  ensureClient,
  fetchRecentMessages,
  sendMessage,
  processInstagramEvent
};

export default instagramService;