import axios from 'axios';
import { logger } from '../server.js'; // Adjust path if needed

export async function processWebhookEvent(webhookEvent) {
  const senderId = webhookEvent.sender.id;
  const timestamp = webhookEvent.timestamp;

  try {
    let messageContent = null;

    // Handle message events (text or quick reply)
    if (webhookEvent.message) {
      messageContent = webhookEvent.message.text || webhookEvent.message.quick_reply?.payload;
      if (!messageContent) {
        logger.warn('Non-text message received, skipping', { senderId, timestamp });
        return;
      }
    }

    // Handle postback events
    if (webhookEvent.postback) {
      messageContent = webhookEvent.postback.payload;
      if (!messageContent) {
        logger.warn('Empty postback payload, skipping', { senderId, timestamp });
        return;
      }
    }

    if (!messageContent) {
      logger.warn('No processable content in webhook event', { senderId, timestamp });
      return;
    }

    logger.info('Routing to Genistudio', { senderId, timestamp, messageContent });

    // Send to Genistudio /message endpoint
    const startTime = Date.now();
    const url = process.env.GENISTUDIO_API_URL + '/message';
    logger.info('Calling Genistudio', { url });
    const { data } = await axios.post(url, {
      chatbotId: process.env.GENISTUDIO_CHATBOT_ID,
      email: `fb_${senderId}@gmail.com`,
      message: messageContent
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
      responseType: 'stream'
    });

    let botResponse = '';
    for await (const chunk of data) {
      botResponse += chunk.toString();
    }

    if (!botResponse) {
      logger.warn('No response from Genistudio', { senderId, timestamp });
      return;
    }

    const genistudioTime = Date.now() - startTime;
    logger.info('Genistudio response received', { botResponse, genistudioTime });

    // Send response back to Facebook
    const facebookStartTime = Date.now();
    await axios.post(
      process.env.FACEBOOK_API_URL + '/me/messages',
      {
        recipient: { id: senderId },
        message: { text: botResponse }
      },
      {
        params: { access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN },
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000
      }
    );

    const facebookTime = Date.now() - facebookStartTime;
    const totalTime = Date.now() - startTime;
    logger.info('Response sent to Facebook', { senderId, totalTime, genistudioTime, facebookTime });

    if (totalTime > 2000) {
      logger.warn('Response time exceeded 2 seconds', { totalTime });
    }
  } catch (error) {
    logger.error('Error processing webhook event', {
      error: error.message,
      senderId,
      timestamp,
      response: error.response?.data || null
    });
    throw error;
  }
}