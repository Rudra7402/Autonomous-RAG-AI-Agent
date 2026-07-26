import dotenv from 'dotenv';
import app from './app.js';
import { connectDB } from './config/db.js';
import { connectRedis } from './config/redis.js';
import './queues/ingest.worker.js'; // Imports and initializes the background worker process

dotenv.config();

const PORT = process.env.PORT || 5000;

// ==========================================================
// GLOBAL ERROR HANDLERS (Prevents Ghost Crashes)
// ==========================================================
process.on('uncaughtException', (err) => {
  console.error('[Fatal Error] Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Fatal Error] Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

/**
 * Bootstrap & Start HTTP Server
 * 
 * 1. Connects to MongoDB Atlas.
 * 2. Connects to Redis Cloud.
 * 3. Starts listening for HTTP requests.
 * 4. Initializes graceful shutdown handlers for production stability.
 */
const startServer = async () => {
  try {
    console.log('--- Initializing RAG Backend System ---');

    // 1. Connect to MongoDB Atlas
    await connectDB();

    // 2. Connect to Redis Cloud
    await connectRedis();

    // 3. Start Express HTTP Server
    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running in [${process.env.NODE_ENV || 'development'}] mode on port ${PORT}`);
      console.log(`📡 Ingestion Upload Endpoint: POST http://localhost:${PORT}/api/ingest`);
      console.log(`🏥 Health Check Endpoint:     GET  http://localhost:${PORT}/health`);
    });

    // Handle Graceful Shutdown (SIGINT, SIGTERM)
    const gracefulShutdown = async (signal) => {
      console.log(`\n[Shutdown] ${signal} signal received. Closing HTTP server and connections...`);
      server.close(() => {
        console.log('[Shutdown] HTTP server closed.');
        process.exit(0);
      });
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  } catch (error) {
    console.error(`[Fatal Startup Error] Server failed to start: ${error.message}`);
    process.exit(1);
  }
};

startServer();
