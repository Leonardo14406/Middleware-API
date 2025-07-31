import WebSocket, { WebSocketServer } from 'ws';
import axios from 'axios';
import { logger } from '../utils/logger.js';

class WebChatSocketService {
  constructor() {
    this.clients = new Map(); // Store client connections with metadata
    this.wss = null;
  }

  initialize(server) {
    this.wss = new WebSocketServer({ 
      server,
      path: '/api/webchat/ws'
    });

    this.wss.on('connection', (ws, _request) => {
      const clientId = this.generateClientId();
      const clientInfo = {
        id: clientId,
        ws: ws,
        email: null,
        chatbotId: null,
        connectedAt: new Date(),
        lastActivity: new Date()
      };

      this.clients.set(clientId, clientInfo);
      logger.info('WebSocket client connected', { clientId, totalClients: this.clients.size });

      // Handle incoming messages
      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          await this.handleMessage(clientId, message);
        } catch (error) {
          logger.error('Error parsing WebSocket message', { clientId, error: error.message });
          this.sendMessage(ws, {
            type: 'error',
            message: 'Invalid message format. Expected JSON.'
          });
        }
      });

      // Handle client disconnect
      ws.on('close', () => {
        const client = this.clients.get(clientId);
        if (client) {
          logger.info('WebSocket client disconnected', { 
            clientId, 
            email: client.email,
            duration: Date.now() - client.connectedAt.getTime()
          });
        }
        this.clients.delete(clientId);
      });

      // Handle errors
      ws.on('error', (error) => {
        logger.error('WebSocket error', { clientId, error: error.message });
        this.clients.delete(clientId);
      });

      // Set up ping/pong for connection health
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        } else {
          clearInterval(pingInterval);
        }
      }, 30000); // Ping every 30 seconds

      ws.on('pong', () => {
        if (this.clients.has(clientId)) {
          this.clients.get(clientId).lastActivity = new Date();
        }
      });
    });

    // Clean up inactive connections every 5 minutes
    setInterval(() => {
      this.cleanupInactiveConnections();
    }, 5 * 60 * 1000);

    logger.info('WebSocket server initialized on /api/webchat/ws');
  }

  async handleMessage(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { ws } = client;
    client.lastActivity = new Date();

    logger.info('WebSocket message received', { 
      clientId, 
      type: message.type,
      email: message.email 
    });

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
        this.sendMessage(ws, {
          type: 'error',
          message: `Unknown message type: ${message.type}`
        });
    }
  }

  async handleAuth(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { chatbotId, email } = message;
    
    if (!chatbotId || !email) {
      this.sendMessage(client.ws, {
        type: 'auth_error',
        message: 'Missing required fields: chatbotId, email'
      });
      return;
    }

    // Update client info
    client.email = email;
    client.chatbotId = chatbotId;

    this.sendMessage(client.ws, {
      type: 'auth_success',
      message: 'Authentication successful',
      email: email,
      chatbotId: chatbotId
    });

    logger.info('Client authenticated', { clientId, email, chatbotId });
  }

  async handleChatMessage(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { ws, email, chatbotId } = client;
    const { message: userMessage } = message;

    if (!email || !chatbotId) {
      this.sendMessage(ws, {
        type: 'error',
        message: 'Not authenticated. Please send auth message first.'
      });
      return;
    }

    if (!userMessage) {
      this.sendMessage(ws, {
        type: 'error',
        message: 'Message content is required'
      });
      return;
    }

    const startTime = Date.now();

    try {
      // Send typing indicator
      this.sendMessage(ws, {
        type: 'ai_typing',
        status: true
      });

      logger.info('Processing WebSocket chat message', { clientId, email, message: userMessage });

      // Call Genistudio AI
      const url = process.env.CHATBOT_API_URL;
      const response = await axios.post(url, {
        chatbotId,
        email,
        message: userMessage
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
        responseType: 'stream'
      });
      
      for await (const chunk of response.data) {
        const chunkText = chunk.toString();
        
        // Send each chunk to the client
        this.sendMessage(ws, {
          type: 'chat_chunk',
          chunk: chunkText,
          isComplete: false
        });
      }

      // Send completion message
      this.sendMessage(ws, {
        type: 'chat_complete',
        isComplete: true
      });

      // Stop typing indicator
      this.sendMessage(ws, {
        type: 'ai_typing',
        status: false
      });

      const totalTime = Date.now() - startTime;
      logger.info('WebSocket chat response completed', { clientId, email, totalTime });

      if (totalTime > 5000) {
        logger.warn('WebSocket chat response time exceeded 5 seconds', { clientId, totalTime });
      }

    } catch (error) {
      logger.error('Error processing WebSocket chat message', {
        clientId,
        error: error.message,
        email,
        message: userMessage
      });

      // Stop typing indicator
      this.sendMessage(ws, {
        type: 'ai_typing',
        status: false
      });

      this.sendMessage(ws, {
        type: 'chat_error',
        message: 'Sorry, I\'m having trouble connecting right now. Please try again later.',
        error: error.message
      });
    }
  }

  async handleTypingIndicator(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;

    // In a multi-user chat, you could broadcast typing indicators to other users
    // For now, just acknowledge the typing indicator
    this.sendMessage(client.ws, {
      type: 'typing_received',
      status: message.status
    });
  }

  sendMessage(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  broadcastMessage(message, excludeClientId = null) {
    this.clients.forEach((client, clientId) => {
      if (clientId !== excludeClientId && client.ws.readyState === WebSocket.OPEN) {
        this.sendMessage(client.ws, message);
      }
    });
  }

  // Broadcast message to specific business clients
  broadcastToBusinessClients(businessId, message, excludeClientId = null) {
    this.clients.forEach((client, clientId) => {
      if (
        clientId !== excludeClientId && 
        client.ws.readyState === WebSocket.OPEN &&
        client.chatbotId === businessId
      ) {
        this.sendMessage(client.ws, message);
      }
    });
  }

  // Handle platform message forwarding to Genistudio
  async forwardPlatformMessageToGenistudio(businessId, platformMessage, platform) {
    try {
      // Send typing indicator to all business clients
      this.broadcastToBusinessClients(businessId, {
        type: 'ai_typing',
        status: true,
        platform: platform,
        threadId: platformMessage.threadId
      });

      logger.info('Forwarding platform message to Genistudio', {
        businessId,
        platform,
        threadId: platformMessage.threadId
      });

      // Call Genistudio API with streaming
      const url = process.env.CHATBOT_API_URL;
      const response = await axios.post(url, {
        chatbotId: businessId,
        email: platformMessage.email || `${platform}-user`,
        message: platformMessage.content,
        context: {
          platform: platform,
          threadId: platformMessage.threadId,
          businessId: businessId,
          timestamp: platformMessage.timestamp
        }
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
        responseType: 'stream'
      });

      let fullReply = '';

      // Stream response chunks to WebSocket clients
      for await (const chunk of response.data) {
        const chunkText = chunk.toString();
        fullReply += chunkText;
        
        // Send each chunk to business clients
        this.broadcastToBusinessClients(businessId, {
          type: 'platform_bot_chunk',
          data: {
            platform: platform,
            threadId: platformMessage.threadId,
            businessId: businessId,
            chunk: chunkText,
            isComplete: false,
            timestamp: new Date()
          }
        });
      }

      // Send completion message
      this.broadcastToBusinessClients(businessId, {
        type: 'platform_bot_complete',
        data: {
          platform: platform,
          threadId: platformMessage.threadId,
          businessId: businessId,
          fullMessage: fullReply,
          isComplete: true,
          timestamp: new Date()
        }
      });

      // Stop typing indicator
      this.broadcastToBusinessClients(businessId, {
        type: 'ai_typing',
        status: false,
        platform: platform,
        threadId: platformMessage.threadId
      });

      return fullReply;

    } catch (error) {
      logger.error('Error forwarding platform message to Genistudio', {
        businessId,
        platform,
        error: error.message
      });

      // Stop typing indicator on error
      this.broadcastToBusinessClients(businessId, {
        type: 'ai_typing',
        status: false,
        platform: platform,
        threadId: platformMessage.threadId
      });

      // Send error message to clients
      this.broadcastToBusinessClients(businessId, {
        type: 'platform_bot_error',
        data: {
          platform: platform,
          threadId: platformMessage.threadId,
          businessId: businessId,
          message: 'Sorry, I\'m having trouble connecting right now. Please try again later.',
          error: error.message,
          timestamp: new Date()
        }
      });

      throw error;
    }
  }

  generateClientId() {
    return 'ws_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
  }

  cleanupInactiveConnections() {
    const now = new Date();
    const inactiveThreshold = 10 * 60 * 1000; // 10 minutes

    this.clients.forEach((client, clientId) => {
      if (now - client.lastActivity > inactiveThreshold) {
        logger.info('Cleaning up inactive WebSocket connection', { clientId, email: client.email });
        client.ws.terminate();
        this.clients.delete(clientId);
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
        lastActivity: client.lastActivity
      }))
    };
  }
}

export const webChatSocketService = new WebChatSocketService();
