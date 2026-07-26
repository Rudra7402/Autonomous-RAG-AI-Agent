import mongoose from 'mongoose';

/**
 * Document Chunk Schema for MongoDB Atlas
 * 
 * In a RAG application, raw documents (like PDFs) are split into smaller paragraphs (chunks).
 * Each chunk is converted into a vector embedding array (e.g., 768 floating-point numbers)
 * using an embedding model (Google Gemini text-embedding-004).
 * 
 * This collection stores both the original text content and its vector embedding,
 * allowing MongoDB Atlas Vector Search to perform cosine similarity searches.
 */
const documentChunkSchema = new mongoose.Schema(
  {
    // The raw text chunk content
    content: {
      type: String,
      required: true
    },
    
    // Vector Embedding Array (768 dimensions for Google Gemini text-embedding-004)
    embedding: {
      type: [Number],
      required: true,
      index: false // We define the Vector Search index directly in MongoDB Atlas UI / Search Indexes
    },
    
    // Metadata about the chunk (file source, chunk number, timestamps, etc.)
    metadata: {
      fileName: {
        type: String,
        required: true
      },
      sessionId: {
        type: String, // Ties this uploaded document specifically to one chat session (ChatGPT style!)
        default: null
      },
      userId: {
        type: String, // Ties document to the user who uploaded it
        default: 'anonymous'
      },
      chunkIndex: {
        type: Number,
        required: true
      },
      totalChunks: {
        type: Number,
        required: true
      },
      pageNumber: {
        type: Number,
        default: null
      },
      fileSize: {
        type: Number
      },
      mimeType: {
        type: String,
        default: 'application/pdf'
      }
    }
  },
  {
    timestamps: true // Automatically creates createdAt and updatedAt fields
  }
);

// Optional: Standard text index for keyword BM25 hybrid search
documentChunkSchema.index({ content: 'text', 'metadata.fileName': 1 });

export const DocumentChunk = mongoose.model('DocumentChunk', documentChunkSchema);
