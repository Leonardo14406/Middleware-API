// config/redis.js
import Redis from "ioredis";
import { logger } from "../utils/logger.js";

let redis;
const useRedis = process.env.USE_REDIS; // Default to true if not set

// Helper to parse Redis URL if provided
function getRedisConfig() {
  // If REDIS_URL is provided, use that (common in cloud environments)
  if (process.env.REDIS_URL) {
    logger.info("Using Redis URL from environment");
    return {
      url: process.env.REDIS_URL,
      tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      connectTimeout: 10000,
      retryStrategy: (times) => {
        const delay = Math.min(times * 500, 5000);
        logger.warn(`Redis connection attempt ${times}, retrying in ${delay}ms`);
        return delay;
      },
    };
  }

  // Fall back to individual config
  return {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    username: process.env.REDIS_USERNAME, // Some cloud providers require username
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || "0"),
    tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
    maxRetriesPerRequest: 3,
    connectTimeout: 10000,
    retryStrategy: (times) => {
      const delay = Math.min(times * 500, 5000);
      logger.warn(`Redis connection attempt ${times}, retrying in ${delay}ms`);
      return delay;
    },
  };
}

if (useRedis) {
  try {
    const config = getRedisConfig();
    logger.info(`Connecting to Redis at ${config.url || `${config.host}:${config.port}`}`);
    
    redis = new Redis(config);

    redis.on("connect", () => {
      logger.info("✅ Redis connected successfully");
    });

    redis.on("ready", () => {
      logger.info("✅ Redis is ready to accept connections");
    });

    redis.on("error", (err) => {
      logger.error("Redis connection error:", {
        message: err.message,
        code: err.code,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
      });
      
      // In production, you might want to implement circuit breaker pattern here
      if (process.env.NODE_ENV === 'production' && times > 5) {
        logger.error("Too many Redis connection attempts, giving up");
      }
    });

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down Redis client...');
      await redis.quit();
      process.exit(0);
    });

  } catch (err) {
    logger.error("Failed to initialize Redis, falling back to in-memory store", {
      message: err.message,
      code: err.code,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
    redis = createMockRedis();
  }
} else {
  logger.info("Redis is disabled, using in-memory store");
  redis = createMockRedis();
}

// Create a simple in-memory mock for Redis
function createMockRedis() {
  const store = new Map();
  
  return {
    async get(key) {
      return store.get(key);
    },
    async set(key, value) {
      store.set(key, value);
      return 'OK';
    },
    async del(key) {
      return store.delete(key) ? 1 : 0;
    },
    async quit() {
      store.clear();
      return 'OK';
    },
    on() { /* noop */ },
    // Add other Redis methods as needed
  };
}

export default redis;
