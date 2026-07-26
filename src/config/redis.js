import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Redis Cloud Connection Client
 * 
 * In our architecture, Redis serves two main purposes:
 * 1. Caching: Caching LLM query responses to reduce response time (latency) and save API costs.
 * 2. Queue Backend: BullMQ uses Redis as a fast, persistent message queue for document processing.
 */

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const redisClient = createClient({
  url: redisUrl
});

// Event Listeners for Redis lifecycle management
redisClient.on('connect', () => {
  console.log('Redis client initiating connection...');
});

redisClient.on('ready', () => {
  console.log('Redis client connected successfully and ready for caching operations.');
});

redisClient.on('error', (err) => {
  console.error(`Redis Error: ${err.message}`);
});

redisClient.on('end', () => {
  console.warn('Redis connection closed.');
});

/**
 * Connects the Redis client to the cloud instance.
 */
export const connectRedis = async () => {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
  } catch (error) {
    console.error(`Failed to connect to Redis Cloud: ${error.message}`);
    // We don't necessarily want to process.exit(1) here if we want our server to work even if cache is temporarily down (Graceful Fallback).
  }
};
