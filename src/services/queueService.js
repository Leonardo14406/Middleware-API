import amqp from 'amqplib';
import prisma from '../config/db.js';
import { logger } from '../utils/logger.js';
import { getAIReply } from './chatbotService.js';
import { pollingService } from './pollingService.js';
import { ensureClient, sendMessage } from './instagramService.js';

let channel;

export async function initQueue() {
  const conn = await amqp.connect(process.env.RABBITMQ_URL);
  channel = await conn.createChannel();
  
  // Delete the existing queue to avoid TTL mismatch
  try {
    await channel.deleteQueue('instagram_messages');
  } catch (err) {
    logger.info('No existing queue to delete or error deleting queue', { error: err.message });
  }
  
  // Create queue with TTL configuration
  await channel.assertQueue('instagram_messages', { 
    durable: true,
    arguments: {
      'x-message-ttl': 86400000 // 24 hours in milliseconds
    }
  });
  
  logger.info('Message queue initialized with TTL');
}

export async function enqueueMessage(message) {
  if (!channel) await initQueue();
  channel.sendToQueue('instagram_messages', Buffer.from(JSON.stringify(message)));
  logger.info('Message enqueued', { businessId: message.businessId, threadId: message.threadId });
}

export async function startQueueWorker() {
  if (!channel) await initQueue();
  channel.consume('instagram_messages', async (msg) => {
    const { businessId, threadId, messageText, userId, messageId, timestamp, chatbotId, platform } = JSON.parse(msg.content.toString());
    const processId = `proc_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      include: { sessions: { where: { platform: 'INSTAGRAM', expiresAt: { gt: new Date() } } } },
    });

    try {
      if (!business || !business.sessions[0]) throw new Error('No business or active Instagram session found');

      const session = business.sessions[0];
      const ig = await ensureClient(business.id, session.serializedCookies);

      const reply = await getAIReply(messageText, chatbotId, {
        platform,
        threadId,
        businessId,
        timestamp: new Date(timestamp).toISOString(),
        userInfo: { platformUserId: userId, threadId },
      });

      await sendMessage(ig, threadId, reply);

      await prisma.message.create({
        data: {
          businessId,
          threadId,
          messageId: `bot_${Date.now()}`,
          content: reply,
          isIncoming: false,
          timestamp: new Date(),
          createdAt: new Date(),
        },
      });

      pollingService.broadcastBotReply(business, { threadId, messageId }, reply, platform, processId);

      logger.info('Message processed and replied', { processId, businessId, threadId, userId });
      channel.ack(msg);
    } catch (err) {
      if (err.message.includes('login_required')) {
        logger.warn('Instagram session invalid or account may be banned', { processId, businessId });
        await prisma.session.deleteMany({ where: { businessId, platform: 'INSTAGRAM' } });
        await prisma.business.update({ where: { id: businessId }, data: { instagramUsername: null } });
      }
      logger.logError(err, { context: 'processMessage', processId, businessId, threadId });
      channel.nack(msg, false, true);
    }
  });
}