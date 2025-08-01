import { logger } from '../utils/logger.js';
import { withRetry } from './pollingService.js';

export async function getAIReply(prompt, chatbotId, context = {}) {
  const requestId = `chatbot_${Date.now()}`;
  try {
    const response = await withRetry(() =>
      fetch(process.env.CHATBOT_API_URL || 'https://genistud.io/api/message', {
        method: 'POST',
        body: JSON.stringify({
          chatbotId,
          email: context.email || process.env.GUEST_EMAIL || 'guest@example.com',
          message: prompt,
          context,
        }),
        headers: { 'Content-Type': 'application/json' },
      })
    );

    if (!response.ok) {
      throw new Error(`Failed to send message. Status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No reader available');
    }

    const decoder = new TextDecoder();
    let fullResponse = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      fullResponse += decoder.decode(value, { stream: true });
    }

    logger.info('Chatbot response received', { requestId, chatbotId, responseLength: fullResponse.length });
    return fullResponse.trim();
  } catch (error) {
    logger.logError(error, { context: 'getAIReply', requestId, chatbotId });
    return 'Sorry, I am having trouble connecting to the AI service.';
  }
}