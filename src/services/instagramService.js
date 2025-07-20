import axios from "axios";
import { logger } from "../server.js";
import asyncHandler from "express-async-handler";

export const processInstagramEvent = asyncHandler(async function processInstagramEvent(webhookEvent) {
  
  const entry = webhookEvent.entry?.[0];
  const messaging = entry?.messaging?.[0];
  if (!messaging) return;

  const senderId = messaging.sender?.id;
  const messageContent = messaging.message?.text;
  const timestamp = messaging.timestamp;

  if (!messageContent) return;

  // Call Genistudio AI
  const url = process.env.GENISTUDIO_API_URL + '/message';
  const { data } = await axios.post(url, {
    chatbotId: process.env.GENISTUDIO_CHATBOT_ID,
    email: `ig_${senderId}@gmail.com`,
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

  // Send response back to Instagram via Meta API
  await axios.post(
    process.env.FACEBOOK_API_URL + '/me/messages',
    {
      recipient: { id: senderId },
      message: { text: botResponse },
      messaging_type: "RESPONSE",
      tag: "HUMAN_AGENT"
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.INSTAGRAM_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );

  const instagramTime = Date.now() - startTime;
  const totalTime = Date.now() - startTime;
  logger.info('Response sent to Instagram', { senderId, totalTime, instagramTime });

  if (totalTime > 2000) {
    logger.warn('Response time exceeded 2 seconds', { totalTime });
    throw new Error('Response time exceeded 2 seconds');
  }
});
