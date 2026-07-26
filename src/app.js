import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { uploadDocumentController, getJobStatusController } from './controllers/ingest.controller.js';
import {
  chatController,
  getChatSessionsController,
  getSessionHistoryController,
  deleteSessionController
} from './controllers/chat.controller.js';
import { signup, login } from './controllers/auth.controller.js';
import { authMiddleware } from './middleware/auth.middleware.js';
import { rateLimiter } from './middleware/rateLimit.middleware.js';

/**
 * Express Application Setup
 * 
 * Configures middleware (CORS, JSON body parser, Multer file upload storage, Flexible Auth)
 * and mounts core API routes for enterprise-grade RAG and Multi-Chat isolation.
 */

const app = express();

// Ensure temporary uploads directory exists
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: timestamp + original filename
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, '_');
    cb(null, `${baseName}-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024 // 20 MB max file size
  }
});

// Middlewares
app.use(helmet({
  contentSecurityPolicy: false, // Disabled for local development to allow inline scripts/styles if any
}));

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? [process.env.FRONTEND_URL || 'https://your-production-url.com']
    : '*',
  credentials: true,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve Showcase Studio Static Frontend UI (Interviewer Demo!)
app.use(express.static(path.join(process.cwd(), 'public')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'RAG Backend API (Multi-Chat Isolated)'
  });
});

// ==========================================================
// 1. AUTHENTICATION API ROUTES (JWT based)
// ==========================================================
app.post('/api/auth/signup', signup);
app.post('/api/auth/login', rateLimiter(10, 60), login);

// ==========================================================
// STRICT AUTH MIDDLEWARE
// Rejects all unauthenticated requests with 401 Unauthorized
// ==========================================================
app.use('/api', authMiddleware);

// ==========================================================
// 2. DOCUMENT INGESTION API ROUTES (Supports Chat Isolation)
// ==========================================================
app.post('/api/ingest', upload.single('file'), uploadDocumentController);
app.get('/api/ingest/status/:jobId', getJobStatusController);

// ==========================================================
// 3. RAG CHAT & SESSION MANAGEMENT ROUTES (ChatGPT style!)
// ==========================================================
app.post('/api/chat', rateLimiter(20, 60), chatController);
app.get('/api/chat/sessions', getChatSessionsController);
app.get('/api/chat/sessions/:sessionId', getSessionHistoryController);
app.delete('/api/chat/sessions/:sessionId', deleteSessionController);

// 404 Route Handler
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.url} not found.` });
});

// Global Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(`[Unhandled Error] ${err.stack}`);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

export default app;
