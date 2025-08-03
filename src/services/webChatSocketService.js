import WebSocket, { WebSocketServer } from 'ws';
import prisma from '../config/db.js';
import { logger } from '../utils/logger.js';
import { getAIReply } from './chatbotService.js';
import { withRetry } from './pollingService.js';

class WebChatSocketService {
  constructor() {
    this.clients = new Map();
    this.chatbotClients = new Map(); // Index clients by chatbotId
    this.wss = null;
    this.MAX_CLIENTS = parseInt(process.env.MAX_WS_CLIENTS || '1000');
  }

  initialize(server) {
    this.wss = new WebSocketServer({ server, path: '/api/webchat/ws' });

    this.wss.on('connection', (ws) => {
      if (this.clients.size >= this.MAX_CLIENTS) {
        logger.warn('Max WebSocket clients reached, rejecting new connection');
        ws.close(1001, 'Maximum clients reached');
        return;
      }

      const clientId = this.generateClientId();
      const clientInfo = {
        id: clientId,
        ws,
        email: null,
        chatbotId: null,
        connectedAt: new Date(),
        lastActivity: new Date(),
      };

      this.clients.set(clientId, clientInfo);
      logger.info('WebSocket client connected', { clientId, totalClients: this.clients.size });

      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (!message.type || typeof message.type !== 'string') {
            throw new Error('Invalid message: type is required and must be a string');
          }
          await this.handleMessage(clientId, message);
        } catch (error) {
          logger.error('Error parsing WebSocket message', { clientId, error: error.message, stack: error.stack });
          this.sendMessage(ws, { type: 'error', message: 'Invalid message format. Expected JSON with type.' });
        }
      });

      ws.on('close', () => {
        const client = this.clients.get(clientId);
        if (client) {
          logger.info('WebSocket client disconnected', {
            clientId,
            email: client.email,
            duration: Date.now() - client.connectedAt.getTime(),
          });
          if (client.chatbotId) {
            this.removeClientFromChatbotIndex(clientId, client.chatbotId);
          }
        }
        this.clients.delete(clientId);
      });

      ws.on('error', (error) => {
        logger.error('WebSocket error', { clientId, error: error.message, stack: error.stack });
        this.clients.delete(clientId);
        if (client.chatbotId) {
          this.removeClientFromChatbotIndex(clientId, client.chatbotId);
        }
      });

      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        } else {
          clearInterval(pingInterval);
        }
      }, 30000);

      ws.on('pong', () => {
        if (this.clients.has(clientId)) {
          this.clients.get(clientId).lastActivity = new Date();
        }
      });
    });

    setInterval(() => this.cleanupInactiveConnections(), 5 * 60 * 1000);
    logger.info('WebSocket server initialized on /api/webchat/ws');
  }

  async handleMessage(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { ws } = client;
    client.lastActivity = new Date();

    logger.info('WebSocket message received', { clientId, type: message.type, email: message.email });

    switch (message.type) {
      case 'auth':
        await this.handleAuth(clientId, message);
        break;
      case 'chat':
        await this.handleChatMessage(clientId, message);
        break;
      case 'typing':
        await this.handleTypingIndicator(clientId, message);
        break;
      case 'ping':
        this.sendMessage(ws, { type: 'pong', timestamp: Date.now() });
        break;
      default:
        this.sendMessage(ws, { type: 'error', message: `Unknown message type: ${message.type}` });
    }
  }

  async handleAuth(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { chatbotId, email } = message;
    if (!chatbotId || !email) {
      this.sendMessage(client.ws, { type: 'auth_error', message: 'Missing required fields: chatbotId, email' });
      return;
    }

    try {
      const business = await prisma.business.findFirst({
        where: { chatbotId, email },
      });
      if (!business) {
        this.sendMessage(client.ws, { type: 'auth_error', message: 'Invalid chatbotId or email' });
        logger.warn('Authentication failed: invalid credentials', { clientId, email, chatbotId });
        return;
      }

      client.email = email;
      client.chatbotId = chatbotId;

      // Add to chatbotClients index
      if (!this.chatbotClients.has(chatbotId)) {
        this.chatbotClients.set(chatbotId, new Set());
      }
      this.chatbotClients.get(chatbotId).add(clientId);

      this.sendMessage(client.ws, { type: 'auth_success', message: 'Authentication successful', email, chatbotId });
      logger.info('Client authenticated', { clientId, email, chatbotId });
    } catch (error) {
      logger.error('Authentication error', { clientId, email, chatbotId, error: error.message, stack: error.stack });
      this.sendMessage(client.ws, { type: 'auth_error', message: 'Server error during authentication' });
    }
  }

  async handleChatMessage(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { ws, email, chatbotId } = client;
    const { message: userMessage } = message;

    if (!email || !chatbotId) {
      this.sendMessage(ws, { type: 'error', message: 'Not authenticated. Please send auth message first.' });
      return;
    }

    if (!userMessage || typeof userMessage !== 'string') {
      this.sendMessage(ws, { type: 'error', message: 'Message content is required and must be a string' });
      return;
    }

    const requestId = `ws_chat_${Date.now()}`;
    try {
      await chatbotService.checkRateLimit(requestId);
      this.sendMessage(ws, { type: 'ai_typing', status: true });
      const reply = await withRetry(() => getAIReply(userMessage, chatbotId, { platform: 'WEBSOCKET', clientId }), 3, 1000);
      this.sendMessage(ws, { type: 'chat', content: reply, isComplete: true });
      this.sendMessage(ws, { type: 'ai_typing', status: false });

      logger.info('WebSocket chat response completed', {
        requestId,
        clientId,
        email,
        chatbotId,
        responseLength: reply.length,
      });
    } catch (error) {
      logger.error('Error processing WebSocket chat message', {
        requestId,
        clientId,
        email,
        chatbotId,
        error: error.message,
        stack: error.stack,
      });
      this.sendMessage(ws, { type: 'ai_typing', status: false });
      this.sendMessage(ws, {
        type: 'chat_error',
        message: error.message.includes('HTTP 429')
          ? 'Chatbot is currently overloaded. Please try again later.'
          : 'Sorry, I\'m having trouble connecting right now.',
      });
    }
  }

  async handleTypingIndicator(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;

    if (typeof message.status !== 'boolean') {
      this.sendMessage(client.ws, { type: 'error', message: 'Typing status must be a boolean' });
      return;
    }

    this.sendMessage(client.ws, { type: 'typing_received', status: message.status });
    logger.debug('Typing indicator processed', { clientId, status: message.status });
  }

  sendMessage(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  broadcastToBusinessClients(chatbotId, message) {
    const clientIds = this.chatbotClients.get(chatbotId) || new Set();
    clientIds.forEach((clientId) => {
      const client = this.clients.get(clientId);
      if (client && client.ws.readyState === WebSocket.OPEN) {
        this.sendMessage(client.ws, message);
      }
    });
    logger.info('Broadcasted to business clients', {
      chatbotId,
      messageType: message.type,
      clientCount: clientIds.size,
    });
  }

  async forwardPlatformMessageToGenistudio(chatbotId, platformMessage, platform) {
    if (!platformMessage.content || typeof platformMessage.content !== 'string') {
      logger.debug('Skipping non-text platform message', {
        chatbotId,
        platform,
        threadId: platformMessage.threadId,
      });
      return null;
    }

    const processId = `proc_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    try {
      await chatbotService.checkRateLimit(processId);
      this.broadcastToBusinessClients(chatbotId, {
        type: 'ai_typing',
        status: true,
        platform,
        threadId: platformMessage.threadId,
      });

      const context = process.env.CHATBOT_SUPPORTS_CONTEXT === 'true'
        ? { platform, threadId: platformMessage.threadId, businessId: platformMessage.businessId, timestamp: platformMessage.timestamp }
        : {};

      const reply = await withRetry(() => getAIReply(platformMessage.content, chatbotId, context), 3, 1000);

      this.broadcastToBusinessClients(chatbotId, {
        type: 'platform_bot_reply',
        data: {
          platform,
          threadId: platformMessage.threadId,
          businessId: platformMessage.businessId,
          messageId: `bot_${Date.now()}_${Math.random().toString(36).substring(2)}`,
          content: reply,
          timestamp: new Date().toISOString(),
          isIncoming: false,
          sender: 'Bot',
          inReplyTo: platformMessage.messageId,
        },
      });

      logger.info('Forwarded platform message to Genistudio', {
        processId,
        chatbotId,
        platform,
        threadId: platformMessage.threadId,
        replyLength: reply.length,
      });

      return reply;
    } catch (error) {
      logger.error('Error forwarding platform message to Genistudio', {
        processId,
        chatbotId,
        platform,
        threadId: platformMessage.threadId,
        error: error.message,
        stack: error.stack,
      });

      this.broadcastToBusinessClients(chatbotId, {
        type: 'platform_bot_error',
        data: {
          platform,
          threadId: platformMessage.threadId,
          businessId: platformMessage.businessId,
          message: error.message.includes('HTTP 429')
            ? 'Chatbot is currently overloaded. Please try again later.'
            : 'Sorry, I\'m having trouble connecting right now.',
          error: error.message,
          timestamp: new Date().toISOString(),
        },
      });

      throw error;
    }
  }

  removeClientFromChatbotIndex(clientId, chatbotId) {
    const clientSet = this.chatbotClients.get(chatbotId);
    if (clientSet) {
      clientSet.delete(clientId);
      if (clientSet.size === 0) {
        this.chatbotClients.delete(chatbotId);
      }
    }
  }

  generateClientId() {
    return 'ws_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
  }

  cleanupInactiveConnections() {
    const now = new Date();
    const inactiveThreshold = 10 * 60 * 1000;

    this.clients.forEach((client, clientId) => {
      if (now - client.lastActivity > inactiveThreshold) {
        logger.info('Cleaning up inactive WebSocket connection', { clientId, email: client.email });
        client.ws.terminate();
        this.clients.delete(clientId);
        if (client.chatbotId) {
          this.removeClientFromChatbotIndex(clientId, client.chatbotId);
        }
      }
    });
  }

  getStats() {
    return {
      totalConnections: this.clients.size,
      connections: Array.from(this.clients.values()).map(client => ({
        id: client.id,
        email: client.email,
        chatbotId: client.chatbotId,
        connectedAt: client.connectedAt,
        lastActivity: client.lastActivity,
      })),
    };
  }
}

export const webChatSocketService = new WebChatSocketService();