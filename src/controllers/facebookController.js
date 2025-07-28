import facebookService from "../services/facebookService.js";
import { webChatSocketService } from "../services/webChatSocketService.js";
import { logger } from "../utils/logger.js";

// Assume `serializedCookies` would come from DB in real usage
const dbSessions = new Map(); // Simulated DB

export async function login(req, res) {
  const { email, password, businessId } = req.body;

  if (!email || !password || !businessId) {
    return res.status(400).json({ error: "Missing credentials or businessId" });
  }

  try {
    const { api: _api, serialized } = await facebookService.loginFacebook(
      email,
      password,
    );

    // Simulate saving to DB
    dbSessions.set(businessId, serialized);

    res.json({ message: "Login successful", businessId });
  } catch (err) {
    logger.error("Login failed", err);
    res.status(500).json({ error: "Login failed", details: err.message });
  }
}

export async function getMessages(req, res) {
  const { businessId } = req.params;

  const serialized = dbSessions.get(businessId);
  if (!serialized)
    return res.status(404).json({ error: "No session for this businessId" });

  try {
    const api = await facebookService.ensureClient(businessId, serialized);
    const messages = await facebookService.fetchRecentMessages(api);
    res.json(messages);
  } catch (err) {
    logger.error("Failed to fetch messages", err);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
}

export async function sendMessage(req, res) {
  const { businessId } = req.params;
  const { threadId, text } = req.body;

  if (!threadId || !text) {
    return res.status(400).json({ error: "Missing threadId or message text" });
  }

  const serialized = dbSessions.get(businessId);
  if (!serialized)
    return res.status(404).json({ error: "No session for this businessId" });

  try {
    const api = await facebookService.ensureClient(businessId, serialized);
    await facebookService.sendMessage(api, threadId, text);
    
    // Broadcast message via WebSocket
    webChatSocketService.broadcastMessage({
      type: 'manual_message_sent',
      data: {
        businessId,
        platform: 'facebook',
        threadId,
        content: text,
        timestamp: new Date(),
        isIncoming: false,
        sender: 'Manual'
      }
    });
    
    res.json({ message: "Message sent" });
  } catch (err) {
    logger.error("Failed to send message", err);
    res.status(500).json({ error: "Failed to send message" });
  }
}
