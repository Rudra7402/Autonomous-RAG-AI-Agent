import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-rag-default-key-2026';

/**
 * Strict Authentication Middleware
 * 
 * - Requires a valid JWT token in Authorization: Bearer <token>.
 * - Rejects unauthorized requests with 401.
 */
export const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Authentication token is required.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = { userId: decoded.userId, email: decoded.email, name: decoded.name };
    next();
  } catch (error) {
    console.warn(`[Auth Middleware] ⚠️ Invalid JWT Token: ${error.message}`);
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token.' });
  }
};
