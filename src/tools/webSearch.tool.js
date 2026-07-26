import { TavilySearch } from '@langchain/tavily';
import dotenv from 'dotenv';

dotenv.config();

/**
 * ============================================================
 * Web Search Tool (Tavily)
 * ============================================================
 * 
 * PURPOSE:
 * When our LangGraph Agent decides that the user's question
 * CANNOT be answered from the uploaded PDFs (e.g., "What is 
 * today's weather?"), the Agent will call this tool to search
 * the live internet and bring back real-time results.
 * 
 * HOW IT WORKS:
 * 1. Agent passes the user's question to this tool.
 * 2. Tavily searches the internet (like Google).
 * 3. Tavily returns the top 3 most relevant web page snippets.
 * 4. Agent passes these snippets to Gemini LLM for summarization.
 * 
 * WHY TAVILY (and not Google Search API)?
 * - Tavily is specifically built for AI agents.
 * - It returns clean, pre-processed text (no HTML junk).
 * - Free tier gives 1,000 searches/month.
 * - Google Custom Search API is expensive and returns raw HTML.
 */

const tavilyApiKey = process.env.TAVILY_API_KEY;

let webSearchTool = null;

if (tavilyApiKey && tavilyApiKey !== 'your_tavily_key_here') {
  // Create the Tavily Search Tool instance
  // maxResults: 3 → Only fetch top 3 web results (keeps response fast & focused)
  webSearchTool = new TavilySearch({
    apiKey: tavilyApiKey,
    maxResults: 3
  });
  console.log('[Web Search Tool] ✅ Tavily Web Search is ENABLED.');
} else {
  console.warn('[Web Search Tool] ⚠️ Tavily API key not found. Web Search will be disabled.');
}

export { webSearchTool };
