import mongoose from 'mongoose';

/**
 * Chat Session Schema for MongoDB Atlas
 * 
 * This collection acts as the "Memory" for our RAG application.
 * Like ChatGPT, if a user asks a follow-up question, the LLM needs to 
 * remember what was discussed previously in that specific chat session.
 */
const sessionSchema = new mongoose.Schema(
  {
    // A unique identifier for a specific chat conversation (e.g., "session_9921")
    sessionId: {
      type: String,
      required: true,
      unique: true, // Ensures no two sessions can accidentally share the same ID
      index: true   // Speeds up fetching the session history from MongoDB
    },

    // Link conversation thread to a specific user (or 'anonymous' for unauthenticated testing)
    userId: {
      type: String,
      default: 'anonymous',
      index: true // Fast queries for displaying multiple chats in sidebar!
    },

    // Auto-derived Title for ChatGPT-style left sidebar preview (e.g. "What is the latest stock...")
    title: {
      type: String,
      default: 'New Conversation'
    },
    
    // Array of message objects representing the conversation turn-by-turn
    messages: [
      {
        // 'user' for human questions, 'ai' or 'assistant' for LLM answers
        role: {
          type: String,
          enum: ['user', 'ai', 'system'],
          required: true
        },
        // The actual text of the question or the answer
        content: {
          type: String,
          required: true
        },
        // Optional metadata (e.g., saving which document chunks were used to answer this specific turn)
        contextUsed: {
          type: Array,
          default: []
        },
        // Timestamp of exactly when this specific message was sent
        timestamp: {
          type: Date,
          default: Date.now
        }
      }
    ],

    // Global metadata for the session (who started it, which file they are talking about)
    metadata: {
      userId: {
        type: String,
        default: 'anonymous'
      },
      fileNameFilter: {
        type: String, // Useful if this chat session is strictly tied to reading a specific PDF
        default: null
      }
    }
  },
  {
    // Automatically creates 'createdAt' (session started) and 'updatedAt' (last message sent)
    timestamps: true 
  }
);

export const ChatSession = mongoose.model('ChatSession', sessionSchema);
