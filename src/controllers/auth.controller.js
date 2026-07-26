import { User } from '../models/user.model.js';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-rag-default-key-2026';
const TOKEN_EXPIRY = '7d';

// Helper function to generate signed JWT tokens
const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id.toString(), email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
};

/**
 * Handle new user registration
 * ROUTE: POST /api/auth/signup
 */
export const signup = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({ error: 'A user with this email already exists.' });
    }

    // Create new user (password is automatically hashed via pre-save hook)
    const user = new User({
      name,
      email: email.toLowerCase(),
      password
    });

    await user.save();
    const token = generateToken(user);

    console.log(`[Auth Controller] ✅ New user registered: ${user.email} (ID: ${user._id})`);

    return res.status(201).json({
      message: 'User registered successfully.',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error(`[Auth Signup Error]: ${error.message}`);
    return res.status(500).json({ error: 'Failed to register user.', details: error.message });
  }
};

/**
 * Handle user login & token generation
 * ROUTE: POST /api/auth/login
 */
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials or email not found.' });
    }

    // Verify password match
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid password.' });
    }

    const token = generateToken(user);
    console.log(`[Auth Controller] 🔑 User logged in successfully: ${user.email}`);

    return res.status(200).json({
      message: 'Login successful.',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error(`[Auth Login Error]: ${error.message}`);
    return res.status(500).json({ error: 'Failed to authenticate user.', details: error.message });
  }
};
