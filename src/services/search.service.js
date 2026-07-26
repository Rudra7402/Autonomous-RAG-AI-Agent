import { MongoDBAtlasVectorSearch } from '@langchain/mongodb';
import { CohereClient } from 'cohere-ai';
import mongoose from 'mongoose';
import { embeddings } from './llm.service.js';
import { DocumentChunk } from '../models/document.model.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * ============================================================
 * Cohere Reranker Client Setup
 * ============================================================
 * 
 * We initialize the Cohere client here ONCE (just like we did
 * with our Redis client and MongoDB connection).
 * 
 * If COHERE_API_KEY exists in .env → Reranker is ENABLED.
 * If COHERE_API_KEY is missing    → System falls back to normal Vector Search.
 */
const cohereApiKey = process.env.COHERE_API_KEY;
let cohereClient = null;

if (cohereApiKey && cohereApiKey !== 'your_cohere_api_key_here') {
  cohereClient = new CohereClient({ token: cohereApiKey });
  console.log('[Search Service] ✅ Cohere Reranker is ENABLED (2-Stage Retrieval Active).');
} else {
  console.warn('[Search Service] ⚠️ Cohere API key not found. Running basic Vector Search only.');
}

/**
 * ============================================================
 * Stage 1: Vector Search (Fast & Broad - MongoDB Atlas)
 * ============================================================
 * 
 * This is our existing vector search function.
 * It takes the user's query, converts it to a vector using Gemini,
 * and finds the top K most similar chunks in MongoDB.
 * 
 * When used WITH Cohere: We ask for 15 chunks (broad net).
 * When used WITHOUT Cohere: We ask for 5 chunks (direct to LLM).
 */
export const vectorSearch = async (query, topK = 5, fileNameFilter = null, sessionId = null) => {
  try {
    // Initialize LangChain's MongoDB Vector Store Wrapper
    const vectorStore = new MongoDBAtlasVectorSearch(embeddings, {
      collection: mongoose.connection.db.collection('documentchunks'),
      indexName: 'vector_index',
      textKey: 'content',
      embeddingKey: 'embedding'
    });

    // Enforce STRICT Chat-Scoped isolation at the Database level!
    // This ensures MongoDB Atlas ONLY searches vectors that belong to this exact Chat Thread.
    const preFilter = {};
    if (fileNameFilter) preFilter['metadata.fileName'] = fileNameFilter;
    if (sessionId) preFilter['metadata.sessionId'] = sessionId;
    
    const filter = Object.keys(preFilter).length > 0 ? { preFilter } : undefined;

    // Perform vector similarity search directly on the isolated chat scope!
    let docs = await vectorStore.similaritySearch(query, topK * 2, filter);

    // Format results neatly for our pipeline
    return docs.slice(0, topK).map(doc => ({
      content: doc.pageContent,
      metadata: doc.metadata
    }));

  } catch (error) {
    console.warn(`[Search Service Warning] Vector search fallback triggered: ${error.message}`);
    
    // Fallback: If Vector Search index is not yet built in Atlas UI
    const filter = {};
    if (fileNameFilter) filter['metadata.fileName'] = fileNameFilter;
    if (sessionId) filter['metadata.sessionId'] = sessionId; // Strict chat isolation!

    const fallbackDocs = await DocumentChunk.find(filter).limit(topK);
    
    return fallbackDocs.map(doc => ({
      content: doc.content,
      metadata: doc.metadata
    }));
  }
};

/**
 * ============================================================
 * Stage 2: Cohere Reranking (Slow & Smart - Cross-Encoder)
 * ============================================================
 * Now supports Chat-Scoped knowledge filtering via sessionId!
 */
export const searchWithRerank = async (query, fileNameFilter = null, sessionId = null) => {

  // If Cohere is not configured, fall back to basic vector search
  if (!cohereClient) {
    console.log('[Search Service] Cohere not available. Using basic vector search.');
    return vectorSearch(query, 5, fileNameFilter, sessionId);
  }

  try {
    // ---------------------------------------------------------------
    // STAGE 1: Cast a wide net — get 15 candidate chunks from MongoDB
    // ---------------------------------------------------------------
    const candidateChunks = await vectorSearch(query, 15, fileNameFilter, sessionId);
    console.log(`[Reranker Stage 1] Retrieved ${candidateChunks.length} candidate chunks from MongoDB.`);

    // If MongoDB returned 0 or 1 chunks, no point in reranking
    if (candidateChunks.length <= 1) {
      return candidateChunks;
    }

    // ---------------------------------------------------------------
    // STAGE 2: Send query + all chunks to Cohere for deep scoring
    // ---------------------------------------------------------------
    const chunkTexts = candidateChunks.map(chunk => chunk.content);

    const rerankResponse = await cohereClient.rerank({
      model: 'rerank-v3.5',           // Cohere's latest and best reranker model
      query: query,                    // The user's question
      documents: chunkTexts,           // The 15 chunk texts to score
      topN: 5,                         // Return only the top 5 best chunks
      returnDocuments: false           // We don't need Cohere to send text back (saves bandwidth)
    });

    // ---------------------------------------------------------------
    // STAGE 3: Map Cohere's ranked results back to our chunk objects
    // ---------------------------------------------------------------
    const rerankedChunks = rerankResponse.results.map(result => {
      const originalChunk = candidateChunks[result.index];
      console.log(`[Reranker] Chunk ${result.index} (Score: ${result.relevanceScore.toFixed(3)}) → "${originalChunk.content.substring(0, 60)}..."`);
      return originalChunk;
    });

    console.log(`[Reranker Stage 2] ✅ Cohere selected top ${rerankedChunks.length} chunks from ${candidateChunks.length} candidates.`);

    return rerankedChunks;

  } catch (error) {
    // If Cohere API fails for any reason, gracefully fall back
    console.error(`[Reranker Error] Cohere reranking failed: ${error.message}. Falling back to basic search.`);
    return vectorSearch(query, 5, fileNameFilter, sessionId);
  }
};
