import dotenv from 'dotenv';

dotenv.config();

/**
 * BullMQ Connection Options
 * 
 * BullMQ is an asynchronous message queue library backed by Redis.
 * In a production RAG system, processing heavy files (PDF parsing, text splitting, embedding creation)
 * takes several seconds or minutes.
 * 
 * Instead of making the user wait on the HTTP request (which would block the server or hit browser timeouts),
 * we push the ingestion task to a BullMQ queue backed by Redis, return an immediate HTTP 202 response,
 * and process the document in the background.
 */

const parseRedisUrl = (urlStr) => {
  if (!urlStr) {
    return { host: 'localhost', port: 6379 };
  }

  try {
    const parsed = new URL(urlStr);
    return {
      host: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port, 10) : 6379,
      username: parsed.username || undefined,
      password: parsed.password || undefined,
      // If using SSL/TLS (rediss://)
      tls: parsed.protocol === 'rediss:' ? { rejectUnauthorized: false } : undefined
    };
  } catch (err) {
    console.error(`Failed to parse REDIS_URL for BullMQ. Using fallback. Error: ${err.message}`);
    return { host: 'localhost', port: 6379 };
  }
};

export const queueConnectionOptions = parseRedisUrl(process.env.REDIS_URL);
