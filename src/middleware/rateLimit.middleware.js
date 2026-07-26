import { redisClient } from '../config/redis.js';

/**
 * Custom Redis API Rate Limiter
 * 
 * Prevents DDoS attacks and API abuse by limiting the number of requests
 * a single IP address can make within a specified time window.
 */
export const rateLimiter = (limit = 20, windowSeconds = 60) => async (req, res, next) => {
  try {
    // Graceful fallback: If Redis is down, allow request to pass (fail open)
    if (!redisClient.isOpen) {
      return next();
    }

    // Get client IP address (handles proxies and load balancers like Render/Heroku)
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown_ip';
    const key = `ratelimit:${req.originalUrl}:${ip}`;

    // INCR increments the value of the key by 1. If key doesn't exist, it sets it to 1.
    // It's atomic, so no race conditions!
    const requests = await redisClient.incr(key);

    // If this is the very first request in the window, set the expiration timer (TTL)
    if (requests === 1) {
      await redisClient.expire(key, windowSeconds);
    }

    // Check if the user exceeded their limit
    if (requests > limit) {
      console.warn(`[Rate Limiter] 🚫 Blocked IP ${ip} for exceeding ${limit} requests/min on ${req.originalUrl}`);
      return res.status(429).json({
        error: 'Too many requests.',
        message: `You have exceeded the limit of ${limit} requests per minute. Please wait and try again later.`
      });
    }

    // Allowed! Add remaining limit headers (optional, good practice)
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', limit - requests);

    next();
  } catch (error) {
    console.error(`[Rate Limiter Error] ${error.message}`);
    next(); // Always fail open so the app doesn't break if Redis errors out
  }
};
