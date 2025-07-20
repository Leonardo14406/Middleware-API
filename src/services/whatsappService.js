import axios from "axios";
import { logger } from "../server.js";
import asyncHandler from "express-async-handler";

export const processWhatsAppEvent = asyncHandler(async function processWhatsAppEvent(webhookEvent) {
  // WhatsApp webhook payload normalization
  const changes = webhookEvent.entry?.[0]?.changes?.[0];
  const value = changes?.value;
  const messages = value?.messages;
  if (!messages || messages.length === 0) return;

  const messageObj = messages[0];
  const senderId = messageObj.from; // WhatsApp user phone number
  const messageContent = messageObj.text?.body;
  const timestamp = messageObj.timestamp;

  if (!messageContent) return;

  // Call Genistudio AI
  const url = process.env.GENISTUDIO_API_URL + '/message';
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

  if (!botResponse) return;

  // Send response back to WhatsApp via Meta Cloud API
  await axios.post(
    process.env.FACEBOOK_API_URL + '/' + process.env.WHATSAPP_PHONE_NUMBER_ID + '/messages',
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

  const whatsappTime = Date.now() - startTime;
  const totalTime = Date.now() - startTime;
  logger.info('Response sent to WhatsApp', { senderId, totalTime, whatsappTime });

  if (totalTime > 2000) {
    logger.warn('Response time exceeded 2 seconds', { totalTime });
    throw new Error('Response time exceeded 2 seconds');
  }
});
