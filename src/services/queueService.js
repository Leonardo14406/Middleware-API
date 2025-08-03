import amqp from 'amqplib';
import { webChatSocketService } from './webChatSocketService.js';
import instagramService from './instagramService.js';
import { logger } from '../utils/logger.js';
import { withRetry } from './pollingService.js';
import prisma from '../config/db.js';

let connection = null;
let channel = null;
const QUEUE_NAME = 'instagram_messages';

async function connectRabbitMQ() {
  const requestId = `rabbitmq_connect_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  try {
    const rabbitmqUrl = process.env.RABBITMQ_URL;
    if (!rabbitmqUrl) {
      throw new Error('RABBITMQ_URL is not defined in environment variables');
    }

    logger.info('Connecting to RabbitMQ', { requestId, url: rabbitmqUrl });
    connection = await amqp.connect(rabbitmqUrl);
    connection.on('error', (err) => {
      logger.error('RabbitMQ connection error', { requestId, error: err.message, stack: err.stack });
    });
    connection.on('close', () => {
      logger.warn('RabbitMQ connection closed', { requestId });
      connection = null;
      channel = null;
    });

    // Create or verify virtual host (if permissions allow)
    channel = await connection.createChannel();
    // Optionally create vhost (requires admin permissions; comment out if not needed)
    // await channel.checkVhost(process.env.RABBITMQ_VHOST || 'oemttpvc');

    await channel.assertQueue(QUEUE_NAME, { durable: true });
    logger.info('✅ RabbitMQ connected and queue initialized', { requestId, queue: QUEUE_NAME });
  } catch (error) {
    logger.error('Failed to connect to RabbitMQ', { requestId, error: error.message, stack: error.stack });
    throw error;
  }
}

export async function initQueue() {
  if (!connection || !channel) {
    await withRetry(connectRabbitMQ, 3, 5000);
  }
}

export async function clearQueue(checkOnly = false) {
  const requestId = `clear_queue_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  try {
    if (!channel) {
      await initQueue();
    }
    const queueInfo = await channel.checkQueue(QUEUE_NAME);
    if (checkOnly) {
      return queueInfo.messageCount;
    }
    await channel.purgeQueue(QUEUE_NAME);
    logger.info('Deleted existing queue', { requestId, messageCount: queueInfo.messageCount });
    return queueInfo.messageCount;
  } catch (error) {
    logger.error('Failed to clear queue', { requestId, error: error.message, stack: error.stack });
    throw error;
  }
}

export async function enqueueMessage(message) {
  const requestId = `enqueue_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  try {
    if (!channel) {
      await initQueue();
    }
    const serializedMessage = Buffer.from(JSON.stringify(message));
    await channel.sendToQueue(QUEUE_NAME, serializedMessage, { persistent: true });
    logger.info('Message enqueued successfully', { requestId, messageId: message.messageId, businessId: message.businessId });
  } catch (error) {
    logger.error('Failed to enqueue message', { requestId, error: error.message, stack: error.stack });
    throw error;
  }
}

export async function startQueueWorker() {
  const requestId = `worker_start_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  try {
    if (!channel) {
      await initQueue();
    }
    await channel.prefetch(1);
    await channel.consume(QUEUE_NAME, async (msg) => {
      if (msg === null) {
        logger.warn('Received null message from queue, ignoring', { requestId });
        return;
      }
      const processId = `proc_${Date.now()}_${Math.random().toString(36).substring(2)}`;
      try {
        const message = JSON.parse(msg.content.toString());
        const { businessId, platform, threadId, messageId, content, userId, timestamp } = message;

        const existingMessage = await prisma.message.findUnique({
          where: { businessId_platform_threadId_messageId: { businessId, platform, threadId, messageId } },
        });
        if (existingMessage) {
          logger.info('Skipping duplicate message', { processId, businessId, messageId, threadId });
          channel.ack(msg);
          return;
        }

        await prisma.message.create({
          data: {
            businessId,
            platform,
            threadId,
            messageId,
            userId,
            content,
            isIncoming: true,
            timestamp: new Date(timestamp),
          },
        });

        await prisma.threadMetadata.upsert({
          where: { businessId_platform_threadId: { businessId, platform, threadId } },
          update: { lastMessageId: messageId, lastProcessedAt: new Date(), updatedAt: new Date() },
          create: {
            businessId,
            platform,
            threadId,
            lastMessageId: messageId,
            lastProcessedAt: new Date(),
            users: JSON.stringify([userId]),
          },
        });

        logger.info('Processing new message', { processId, businessId, messageId, threadId, platform });

        const business = await prisma.business.findUnique({ where: { id: businessId } });
        if (!business) {
          throw new Error('Business not found');
        }

        const reply = await webChatSocketService.forwardPlatformMessageToGenistudio(business.chatbotId, message, platform);
        if (reply) {
          if (platform === 'INSTAGRAM') {
            await instagramService.sendMessage(business.id, threadId, reply);
            await prisma.message.create({
              data: {
                businessId,
                platform,
                threadId,
                messageId: `bot_${Date.now()}_${Math.random().toString(36).substring(2)}`,
                userId: 'bot',
                content: reply,
                isIncoming: false,
                timestamp: new Date(),
              },
            });
            logger.info('Bot reply sent via Instagram', { processId, businessId, threadId, replyLength: reply.length });
          }
        }

        channel.ack(msg);
      } catch (error) {
        logger.error('Error processing message', { processId, error: error.message, stack: error.stack });
        channel.nack(msg, false, true);
      }
    }, { noAck: false });

    logger.info('Queue worker started', { requestId, queue: QUEUE_NAME });
  } catch (error) {
    logger.error('Failed to start queue worker', { requestId, error: error.message, stack: error.stack });
    throw error;
  }
}

export async function closeQueue() {
  const requestId = `close_queue_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  try {
    if (channel) {
      await channel.close();
      logger.info('RabbitMQ channel closed', { requestId });
    }
    if (connection) {
      await connection.close();
      logger.info('RabbitMQ connection closed', { requestId });
    }
  } catch (error) {
    logger.error('Failed to close queue', { requestId, error: error.message, stack: error.stack });
    throw error;
  }
}