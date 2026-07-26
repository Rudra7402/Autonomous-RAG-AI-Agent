import { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.warn('WARNING: GEMINI_API_KEY is not defined in environment variables.');
}

/**
 * Google Gemini LLM Service Setup
 * 
 * We initialize two distinct LangChain objects:
 * 1. embeddings: Converts text into 768-dimensional vector arrays.
 * 2. llm: The chat model used to generate answers from context.
 */

const rawEmbeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: apiKey,
  model: 'gemini-embedding-001'
});

// Auto-slice vectors to 768 dimensions so it matches MongoDB Atlas index perfectly without any manual setup!
export const embeddings = {
  embedQuery: async (text) => {
    const vector = await rawEmbeddings.embedQuery(text);
    return vector.slice(0, 768);
  },
  embedDocuments: async (documents) => {
    const vectors = await rawEmbeddings.embedDocuments(documents);
    return vectors.map(v => v.slice(0, 768));
  }
};

// Chat LLM model used for generating final user answers
export const llm = new ChatGoogleGenerativeAI({
  apiKey: apiKey,
  model: 'gemini-flash-lite-latest',
  temperature: 0.2, // Low temperature (0.2) ensures more factual, non-hallucinated responses
  maxOutputTokens: 2048
});
