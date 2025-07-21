import axios from "axios";
import { logger } from "../server.js";
import asyncHandler from "express-async-handler";

export const processWhatsAppEvent = asyncHandler(async function processWhatsAppEvent(webhookEvent) {
  const startTime = Date.now();
  
  // Handle normalized webhook event (converted from WhatsApp format to Facebook format)
  const senderId = webhookEvent.sender?.id;
  const messageContent = webhookEvent.message?.text;
  const timestamp = webhookEvent.timestamp;

  if (!senderId || !messageContent) {
    logger.warn('Invalid WhatsApp webhook event', { senderId, messageContent, timestamp });
    return;
  }

  logger.info('Routing WhatsApp message to Genistudio', { senderId, timestamp, messageContent });

  // Call Genistudio AI
  const genistudioStartTime = Date.now();
  const url = process.env.GENISTUDIO_API_URL + '/message';
  logger.info('Calling Genistudio', { url });
  const { data } = await axios.post(url, {
    chatbotId: process.env.GENISTUDIO_CHATBOT_ID,
    email: `wa_${senderId}@gmail.com`,
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
  
  const genistudioTime = Date.now() - genistudioStartTime;
  logger.info('Genistudio response received', { botResponse, genistudioTime });

  if (!botResponse) {
    logger.warn('Empty response from Genistudio', { senderId });
    return;
  }

  // Send response back to WhatsApp via Meta Cloud API
  const whatsappStartTime = Date.now();
  try {
    await axios.post(
      `https://graph.facebook.com/v17.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: senderId,
        type: "text",
        text: { body: botResponse }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const whatsappTime = Date.now() - whatsappStartTime;
    const totalTime = Date.now() - startTime;
    logger.info('Response sent to WhatsApp', { senderId, totalTime, whatsappTime, genistudioTime });

    if (totalTime > 2000) {
      logger.warn('Response time exceeded 2 seconds', { totalTime });
    }
  } catch (error) {
    logger.error('Failed to send WhatsApp message', {
      senderId,
      error: error.message,
      response: error.response?.data,
      status: error.response?.status
    });
    throw error;
  }
});
