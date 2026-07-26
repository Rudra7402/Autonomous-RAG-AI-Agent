import { redisClient } from '../config/redis.js';

/**
 * Cache Service (Redis Key-Value Caching Layer)
 * 
 * Provides utility functions to check, retrieve, store, and clear
 * cached LLM responses in Redis Cloud to minimize API latency and costs.
 */

// Default cache expiration time: 3600 seconds (1 hour)
const DEFAULT_TTL_SECONDS = 3600;

/**
 * Generates a clean, normalized Redis cache key from a query string.
 * Converts to lowercase and strips leading/trailing whitespaces.
 * 
 * Example: "  What is Remote Work?  " => "rag_cache:what is remote work?"
 */
const formatCacheKey = (query, fileNameFilter = null) => {
  const normalizedQuery = query.trim().toLowerCase();
  const filePrefix = fileNameFilter ? `[file:${fileNameFilter}]` : '[file:all]';
  return `rag_cache:${filePrefix}:${normalizedQuery}`;
};

/**
 * Retrieves a cached LLM response from Redis.
 * 
 * @param {string} query - The user's input question
 * @param {string} [fileNameFilter] - Optional filename scope
 * @returns {Promise<string|null>} The cached response string if found, otherwise null
 */
export const getCachedResponse = async (query, fileNameFilter = null) => {
  try {
    // If Redis is not connected, return null to allow graceful fallback to LLM
    if (!redisClient.isOpen) {
      return null;
    }

    const key = formatCacheKey(query, fileNameFilter);
    const cachedData = await redisClient.get(key);

    if (cachedData) {
      console.log(`[Cache Service] ⚡ CACHE HIT for key: "${key}"`);
      return JSON.parse(cachedData);
    }

    console.log(`[Cache Service] 🐢 CACHE MISS for key: "${key}"`);
    return null;

  } catch (error) {
    console.error(`[Cache Service Error] Failed to read from Redis: ${error.message}`);
    return null; // Graceful degradation: proceed without cache
  }
};

/**
 * Stores an LLM response pair in Redis with an expiration TTL.
 * 
 * @param {string} query - The user's input question
 * @param {object} responsePayload - The JSON response containing answer text and metadata
 * @param {string} [fileNameFilter] - Optional filename scope
 * @param {number} [ttlSeconds] - Time to live in seconds (default: 3600s)
 */
export const setCachedResponse = async (query, responsePayload, fileNameFilter = null, ttlSeconds = DEFAULT_TTL_SECONDS) => {
  try {
    if (!redisClient.isOpen) {
      return;
    }

    const key = formatCacheKey(query, fileNameFilter);
    const value = JSON.stringify(responsePayload);

    // Store key-value pair in Redis with Expiration (EX)
    await redisClient.set(key, value, {
      EX: ttlSeconds
    });

    console.log(`[Cache Service] 💾 Response cached successfully in Redis under key: "${key}" (TTL: ${ttlSeconds}s)`);

  } catch (error) {
    console.error(`[Cache Service Error] Failed to write to Redis: ${error.message}`);
  }
};
