import { Queue } from 'bullmq';
import { queueConnectionOptions } from '../config/queue.js';

/**
 * Document Ingestion Queue Definition
 * 
 * This queue manages background jobs for parsing, chunking, embedding, and storing
 * uploaded document files in MongoDB Atlas.
 */

export const INGEST_QUEUE_NAME = 'document-ingestion-queue';

export const ingestQueue = new Queue(INGEST_QUEUE_NAME, {
  connection: queueConnectionOptions,
  defaultJobOptions: {
    // Retry up to 3 times if a job fails (e.g. temporary API rate limit or network glitch)
    attempts: 3,
    // Exponential backoff strategy: wait 2s, then 4s, then 8s before retrying
    backoff: {
      type: 'exponential',
      delay: 2000
    },
    // Auto-clean completed jobs from Redis after 24 hours or if count exceeds 1000
    removeOnComplete: {
      age: 86400, // 24 hours in seconds
      count: 1000
    },
    // Retain failed jobs for 7 days in Redis for developer debugging
    removeOnFail: {
      age: 604800 // 7 days in seconds
    }
  }
});
