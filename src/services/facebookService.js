import login from "facebook-chat-api";
import redis from "../config/redis.js";
import { logger } from "../utils/logger.js";
import https from "https";

async function cacheKey(businessId) {
  return `fb-client:${businessId}`;
}

async function loginFacebook(email, password, retryCount = 0) {
  const maxRetries = 2;
  
  // Test connectivity first
  const isConnected = await testFacebookConnectivity();
  if (!isConnected) {
    throw new Error("Unable to connect to Facebook servers. Please check your internet connection or try again later. This might be due to network issues, firewall restrictions, or regional blocking.");
  }

  return new Promise((resolve, reject) => {
    // Try different credential configurations for better compatibility
    const credentials = { 
      email, 
      password,
      forceLogin: true,
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    };
    
    // Set a timeout for the login attempt (increased for slow connections)
    const loginTimeout = setTimeout(() => {
      reject(new Error("Facebook login timeout - Unable to connect to Facebook servers. This may be due to slow network, regional blocking, or Facebook server issues."));
    }, 60000); // 60 second timeout for slow connections
    
    login(credentials, async (err, api) => {
      clearTimeout(loginTimeout);
      
      if (err) {
        // Handle different types of errors
        let errorMessage = "Unknown Facebook login error";
        
        if (err.code === 'ETIMEDOUT' || err.code === 'ENETUNREACH') {
          errorMessage = "Network connection error - Unable to reach Facebook servers. Please check your internet connection or try again later.";
          
          // Retry for network errors
          if (retryCount < maxRetries) {
            logger.warn(`Facebook login retry ${retryCount + 1}/${maxRetries} due to network error`, { 
              email: email.replace(/(.{2}).*(@.*)/, '$1***$2'),
              errorCode: err.code 
            });
            
            // Wait before retry with exponential backoff
            await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 2000));
            
            try {
              const result = await loginFacebook(email, password, retryCount + 1);
              return resolve(result);
            } catch (retryErr) {
              return reject(retryErr);
            }
          }
        } else if (err.error && err.error.includes("retrieving userID")) {
          errorMessage = "Facebook security block detected. Please:\n1. Login to Facebook in a browser first\n2. Complete any security challenges\n3. Keep the browser session active\n4. Try again in a few minutes\n\nThis usually happens when Facebook detects a login from a new location or suspects automated access.";
        } else if (err.error && err.error.includes("wrong password")) {
          errorMessage = "Invalid Facebook credentials. Please check your email and password.";
        } else if (err.error && err.error.includes("captcha")) {
          errorMessage = "Facebook requires captcha verification. Please login via browser first to complete the captcha challenge.";
        } else if (err.error && err.error.includes("checkpoint")) {
          errorMessage = "Facebook account requires security checkpoint verification. Please login via browser and complete the verification process.";
        } else if (err.error) {
          errorMessage = err.error;
        } else if (err.message) {
          errorMessage = err.message;
        } else {
          errorMessage = `Connection failed: ${err.code || 'Unknown error'}`;
        }
        
        logger.error("Facebook login failed", { 
          error: errorMessage,
          errorCode: err.code || 'UNKNOWN',
          email: email.replace(/(.{2}).*(@.*)/, '$1***$2'), // Partially mask email in logs
          retryCount
        });
        
        return reject(new Error(`Facebook login failed: ${errorMessage}`));
      }

      try {
        // Get and serialize the app state (session cookies)
        const appState = api.getAppState();
        const serialized = JSON.stringify(appState);

        logger.info("Facebook login successful", { 
          email: email.replace(/(.{2}).*(@.*)/, '$1***$2'),
          userID: api.getCurrentUserID() 
        });

        resolve({
          api,
          serialized: serialized,
        });
      } catch (serializeErr) {
        logger.error("Failed to serialize Facebook app state", { error: serializeErr.message });
        reject(new Error("Failed to serialize Facebook session"));
      }
    });
  });
}

async function restoreSession(serializedCookies) {
  return new Promise((resolve, reject) => {
    try {
      const appState = JSON.parse(serializedCookies);
      
      // Set a timeout for the session restoration (increased for slow connections)
      const restoreTimeout = setTimeout(() => {
        reject(new Error("Facebook session restoration timeout - Unable to connect to Facebook servers"));
      }, 45000); // 45 second timeout for slow connections
      
      login({ appState }, (err, api) => {
        clearTimeout(restoreTimeout);
        
        if (err) {
          let errorMessage = "Session restoration failed";
          
          if (err.code === 'ETIMEDOUT' || err.code === 'ENETUNREACH') {
            errorMessage = "Network connection error during session restoration";
          } else if (err.error) {
            errorMessage = err.error;
          } else if (err.message) {
            errorMessage = err.message;
          }
          
          logger.error("Facebook session restoration failed", { 
            error: errorMessage,
            errorCode: err.code || 'UNKNOWN'
          });
          return reject(new Error(`Failed to restore Facebook session: ${errorMessage}`));
        }

        logger.info("Facebook session restored successfully", { 
          userID: api.getCurrentUserID() 
        });
        
        resolve(api);
      });
    } catch (parseErr) {
      logger.error("Failed to parse Facebook app state", { error: parseErr.message });
      reject(new Error("Invalid Facebook session data"));
    }
  });
}

async function ensureClient(businessId, serializedCookies) {
  const key = await cacheKey(businessId);

  try {
    const cachedSession = await redis.get(key);
    if (cachedSession) {
      try {
        const api = await restoreSession(cachedSession);
        logger.info("Using cached Facebook session", { businessId });
        return api;
      } catch (sessionErr) {
        logger.warn("Invalid session in Redis, restoring from DB", {
          businessId,
          error: sessionErr.message
        });
        await redis.del(key);
      }
    }
  } catch (redisErr) {
    logger.warn("Redis unavailable, falling back to DB session", {
      businessId,
      error: redisErr.message,
    });
  }

  const api = await restoreSession(serializedCookies);
  logger.info("Facebook session restored from DB", { businessId });

  try {
    await redis.set(key, serializedCookies, "EX", 3600); // 1 hour cache
    logger.info("Facebook session cached successfully", { businessId });
  } catch (cacheErr) {
    logger.warn("Failed to cache session in Redis", {
      businessId,
      error: cacheErr.message,
    });
  }

  return api;
}

async function fetchRecentMessages(api, limit = 20) {
  return new Promise((resolve, reject) => {
    api.getThreadList(0, limit, "inbox", (err, threads) => {
      if (err) return reject(err);

      const messages = [];
      let count = 0;

      const fetchEach = threads.slice(0, 5).map(
        (thread) =>
          new Promise((res, rej) => {
            api.getThreadHistory(
              thread.threadID,
              limit / 5,
              undefined,
              (err, threadMessages) => {
                if (err) return rej(err);

                threadMessages.forEach((msg) => {
                  messages.push({
                    threadId: thread.threadID,
                    messageId: msg.messageID,
                    content: msg.body || "[Media]",
                    timestamp: new Date(msg.timestamp),
                    isIncoming: msg.senderID !== api.getCurrentUserID(),
                  });
                });

                count++;
                res();
              },
            );
          }),
      );

      Promise.all(fetchEach)
        .then(() => resolve(messages.sort((a, b) => b.timestamp - a.timestamp)))
        .catch(reject);
    });
  });
}

async function sendMessage(api, threadId, text) {
  return new Promise((resolve, reject) => {
    const message = typeof text === 'string' ? { body: text } : text;
    
    api.sendMessage(message, threadId, (err, messageInfo) => {
      if (err) {
        logger.error("Failed to send Facebook message", { 
          error: err.message,
          threadId: threadId.substring(0, 10) + "..." // Partially mask thread ID
        });
        return reject(new Error(`Failed to send Facebook message: ${err.message}`));
      }
      
      logger.info("Facebook message sent successfully", { 
        threadId: threadId.substring(0, 10) + "...",
        messageID: messageInfo.messageID 
      });
      
      resolve(messageInfo);
    });
  });
}

// Test Facebook connectivity before attempting login
async function testFacebookConnectivity() {
  return new Promise((resolve) => {
    const options = {
      hostname: 'www.facebook.com',
      port: 443,
      path: '/',
      method: 'GET',
      timeout: 15000, // Increased timeout for slow connections
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ChatBot/1.0)'
      }
    };

    const req = https.request(options, (res) => {
      logger.info("Facebook connectivity test successful", { 
        statusCode: res.statusCode,
        responseTime: Date.now() - startTime
      });
      
      // Consider 2xx, 3xx responses as successful connectivity
      if (res.statusCode >= 200 && res.statusCode < 400) {
        resolve(true);
      } else {
        logger.warn("Facebook connectivity test - unexpected status", { statusCode: res.statusCode });
        resolve(false);
      }
    });

    const startTime = Date.now();

    req.on('error', (err) => {
      const responseTime = Date.now() - startTime;
      logger.error("Facebook connectivity test failed", { 
        error: err.message,
        code: err.code,
        responseTime
      });
      resolve(false);
    });

    req.on('timeout', () => {
      const responseTime = Date.now() - startTime;
      logger.error("Facebook connectivity test timed out", { responseTime });
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

// Additional utility functions based on Facebook Chat API documentation

async function markAsRead(api, threadId) {
  return new Promise((resolve, reject) => {
    api.markAsRead(threadId, (err) => {
      if (err) {
        logger.error("Failed to mark Facebook message as read", { 
          error: err.message,
          threadId: threadId.substring(0, 10) + "..."
        });
        return reject(err);
      }
      resolve();
    });
  });
}

async function sendTypingIndicator(api, threadId, _isTyping = true) {
  return new Promise((resolve, reject) => {
    api.sendTypingIndicator(threadId, (err) => {
      if (err) {
        logger.error("Failed to send typing indicator", { 
          error: err.message,
          threadId: threadId.substring(0, 10) + "..."
        });
        return reject(err);
      }
      resolve();
    });
  });
}

async function getUserInfo(api, userIds) {
  return new Promise((resolve, reject) => {
    api.getUserInfo(userIds, (err, userInfo) => {
      if (err) {
        logger.error("Failed to get user info", { error: err.message });
        return reject(err);
      }
      resolve(userInfo);
    });
  });
}

async function getThreadInfo(api, threadId) {
  return new Promise((resolve, reject) => {
    api.getThreadInfo(threadId, (err, threadInfo) => {
      if (err) {
        logger.error("Failed to get thread info", { 
          error: err.message,
          threadId: threadId.substring(0, 10) + "..."
        });
        return reject(err);
      }
      resolve(threadInfo);
    });
  });
}

// Exporting main functions used by the business controller
export {
  loginFacebook,
  restoreSession,
  ensureClient,
  fetchRecentMessages,
  sendMessage,
  markAsRead,
  sendTypingIndicator,
  getUserInfo,
  getThreadInfo,
  testFacebookConnectivity,
};

const facebookService = {
  loginFacebook,
  restoreSession,
  ensureClient,
  fetchRecentMessages,
  sendMessage,
  markAsRead,
  sendTypingIndicator,
  getUserInfo,
  getThreadInfo,
  testFacebookConnectivity,
};

export default facebookService;
