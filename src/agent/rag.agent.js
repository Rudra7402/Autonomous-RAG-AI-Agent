/**
 * ============================================================
 * RAG Agent - LangGraph Autonomous Agent
 * ============================================================
 * 
 * This is the BRAIN of our application.
 * Instead of running a fixed sequence (search → generate),
 * this Agent DECIDES at each step what to do next.
 * 
 * File will be built in 4 sub-steps:
 * Step 3a: Imports + State + Router Node ← (THIS STEP)
 * Step 3b: Retrieve Node + Grade Documents Node
 * Step 3c: Web Search Node + Query Rewrite Node + Generate Node
 * Step 3d: Graph Construction (connecting all nodes with edges)
 */

// ============================================================
// IMPORTS
// ============================================================

// LangGraph: The framework that lets us build a decision graph
import { StateGraph, END } from '@langchain/langgraph';

// Our existing LangChain services (NOTHING CHANGES in these files!)
import { llm } from '../services/llm.service.js';
import { searchWithRerank } from '../services/search.service.js';
import { webSearchTool } from '../tools/webSearch.tool.js';

// LangChain message types for building prompts
import { SystemMessage, HumanMessage } from '@langchain/core/messages';

// ============================================================
// STATE DEFINITION
// ============================================================
// 
// "State" is a shared data object that TRAVELS through every Node.
// Think of it like a train — at each station (Node), passengers
// (data) get on or off. Every Node can READ from state and
// WRITE new data into state.
//
// We define what fields our State will contain:
//
// Example of what state looks like at runtime:
// {
//   query: "What is Rudra's CGPA?",
//   documents: [{ content: "...", metadata: {...} }, ...],
//   webResults: "Apple stock is...",
//   answer: "Rudra's CGPA is 8.35",
//   route: "document_search",
//   retryCount: 0,
//   fileNameFilter: null
// }

// In LangGraph, we define state as a simple object with "reducer" functions.
// A reducer tells LangGraph HOW to update each field when a Node returns new data.
// For most fields, we just want to REPLACE the old value with the new value.

const graphState = {
  query:          { value: (old, updated) => updated ?? old, default: () => '' },
  originalQuery:  { value: (old, updated) => updated ?? old, default: () => '' },
  documents:      { value: (old, updated) => updated ?? old, default: () => [] },
  webResults:     { value: (old, updated) => updated ?? old, default: () => '' },
  answer:         { value: (old, updated) => updated ?? old, default: () => '' },
  route:          { value: (old, updated) => updated ?? old, default: () => '' },
  retryCount:     { value: (old, updated) => updated ?? old, default: () => 0 },
  fileNameFilter: { value: (old, updated) => updated ?? old, default: () => null },
  sessionId:      { value: (old, updated) => updated ?? old, default: () => null },
  chatHistory:    { value: (old, updated) => updated ?? old, default: () => '' }
};

// ============================================================
// NODE 1: ROUTER NODE
// ============================================================
//
// This is the FIRST node that runs when a user sends a question.
// Its job: Read the question and DECIDE which path to take.
//
// It asks Gemini LLM: "Look at this question. Should I search
// the PDF database, search the internet, or just chat directly?"
//
// Gemini responds with ONE WORD: 
//   "document_search" or "web_search" or "direct_chat"
//
// That word gets stored in state.route, and later our
// Conditional Edge will read state.route to decide which
// Node runs next.

const routerNode = async (state) => {
  console.log('[Agent] 🚦 Router Node: Analyzing query intent...');

  // We give Gemini very strict instructions:
  // "You are a router. Just classify this question. Nothing else."
  const routerPrompt = [
    new SystemMessage(
      `You are a query router for a RAG (Retrieval-Augmented Generation) system.
      Your ONLY job is to classify the user's question into ONE of these 3 categories:
      
      1. "document_search" → If the question is about information that could be found 
         in uploaded documents (resumes, reports, PDFs, notes, etc.)
         Examples: "What are Rudra's skills?", "Summarize the report", "What is the CGPA?"
      
      2. "web_search" → If the question requires real-time, current, or live information 
         from the internet that would NOT be in uploaded documents.
         Examples: "What is today's weather?", "Latest news about AI", "Current stock price"
      
      3. "direct_chat" → If the question is a casual greeting, general knowledge, 
         or conversational message that needs no search at all.
         Examples: "Hi", "Hello", "What is 2+2?", "Tell me a joke"
      
      RESPOND WITH ONLY ONE OF THESE EXACT WORDS: document_search, web_search, direct_chat
      DO NOT add any explanation. Just the classification word. If the latest question is a short reply to a previous turn (e.g. providing a city name for weather), classify according to the ongoing topic!`
    ),
    new HumanMessage(
      `${state.chatHistory ? `RECENT CONVERSATION HISTORY:\n${state.chatHistory}\n\n` : ''}LATEST USER QUESTION: ${state.query}`
    )
  ];

  try {
    // Call Gemini to classify the question
    const routerResponse = await llm.invoke(routerPrompt);

    // Extract the classification word and clean it up
    // .trim() removes extra spaces, .toLowerCase() ensures consistent format
    const route = routerResponse.content.trim().toLowerCase();

    console.log(`[Agent] 🚦 Router Decision: "${route}" for query: "${state.query}"`);

    // Return the route decision — this gets merged into the shared State object
    return { route };
  } catch (error) {
    console.error(`[Agent Error] 🚦 Router Node LLM failed: ${error.message}`);
    return { route: 'direct_chat' }; // Safe fallback
  }
};

// ============================================================
// NODE 2: RETRIEVE NODE
// ============================================================
//
// This node calls our EXISTING searchWithRerank() function
// (MongoDB Vector Search + Cohere Reranking).
//
// It takes the user's query from state, searches the database,
// and puts the retrieved document chunks into state.documents.
//
// Notice: We are NOT writing any new search logic here!
// We are simply calling our existing service function.

const retrieveNode = async (state) => {
  console.log('[Agent] 🔍 Retrieve Node: Searching documents with Vector Search + Cohere Rerank...');

  // If the user's latest query is short, combine it with the previous topic so the Vector DB knows what book/context to search!
  let searchQuery = state.query;
  if (state.chatHistory && state.query.split(' ').length <= 4) {
    const historyLines = state.chatHistory.split('\n');
    const initialUserTopic = historyLines[historyLines.length - 3] || '';
    searchQuery = `${initialUserTopic} ${state.query}`.trim();
    console.log(`[Agent] 🔍 Contextualized short document search query: "${searchQuery}"`);
  }

  // Call our existing 2-Stage Retrieval function with Chat-Scoped knowledge isolation!
  const documents = await searchWithRerank(searchQuery, state.fileNameFilter, state.sessionId);

  console.log(`[Agent] 🔍 Retrieved ${documents.length} chunks from database.`);

  // Put the retrieved chunks into the shared State
  return { documents };
};

// ============================================================
// NODE 3: GRADE DOCUMENTS NODE
// ============================================================
//
// This is the SELF-CORRECTION node. After retrieving chunks,
// this node checks: "Are these chunks ACTUALLY relevant to
// the user's question?"
//
// HOW IT WORKS:
// 1. It takes the first retrieved chunk's text.
// 2. It asks Gemini: "Is this chunk relevant to this question?"
// 3. Gemini responds with ONLY "yes" or "no".
// 4. If "yes" → route to "generate" (make the answer).
// 5. If "no"  → route to "rewrite" (rewrite the query and retry).
//
// WHY IS THIS IMPORTANT?
// Sometimes Vector Search returns chunks that LOOK similar
// (mathematically) but don't actually answer the question.
// This node catches those mistakes before Gemini generates
// a wrong answer!

const gradeDocumentsNode = async (state) => {
  console.log('[Agent] 📝 Grade Documents Node: Checking if retrieved chunks are relevant...');

  // If no documents were found at all, go straight to web search
  if (!state.documents || state.documents.length === 0) {
    console.log('[Agent] 📝 No documents found. Routing to web search.');
    return { route: 'web_search' };
  }

  // Take the highest-ranked chunk (Cohere already put the best one first!)
  const topChunk = state.documents[0].content;

  // Ask Gemini to grade this chunk's relevance
  const gradePrompt = [
    new SystemMessage(
      `You are a document relevance grader.
      You will be given a QUESTION and a DOCUMENT chunk.
      Your job: Does this document chunk contain information that helps answer the question?
      
      RESPOND WITH ONLY ONE WORD: "yes" or "no"
      DO NOT explain. Just "yes" or "no".`
    ),
    new HumanMessage(
      `${state.chatHistory ? `CONVERSATION CONTEXT:\n${state.chatHistory}\n\n` : ''}LATEST QUESTION: ${state.query}\n\nDOCUMENT CHUNK: ${topChunk}`
    )
  ];

  try {
    const gradeResponse = await llm.invoke(gradePrompt);
    const grade = gradeResponse.content.trim().toLowerCase();

    if (grade.includes('yes')) {
      console.log('[Agent] 📝 Grade: ✅ Documents ARE relevant. Proceeding to generate answer.');
      return { route: 'generate' };
    } else {
      // Check retry count to prevent infinite loops
      // We allow maximum 1 retry (rewrite query once, search again once)
      if (state.retryCount >= 1) {
        console.log('[Agent] 📝 Grade: ❌ Documents NOT relevant. Max retries reached. Routing to web search.');
        return { route: 'web_search' };
      }
      console.log('[Agent] 📝 Grade: ❌ Documents NOT relevant. Routing to query rewrite.');
      return { route: 'rewrite', retryCount: state.retryCount + 1 };
    }
  } catch (error) {
    console.error(`[Agent Error] 📝 Grader Node LLM failed: ${error.message}`);
    // Safe fallback: assume relevant to prevent crashes
    return { route: 'generate' };
  }
};

// ============================================================
// NODE 4: WEB SEARCH NODE
// ============================================================
//
// This node runs when the Router or Grader decides that the
// user's question needs live internet data.
//
// It calls our Tavily Web Search tool (from webSearch.tool.js)
// and stores the results in state.webResults.
//
// If Tavily is not configured, it stores a fallback message.

const webSearchNode = async (state) => {
  console.log('[Agent] 🌐 Web Search Node: Searching the internet via Tavily...');

  if (!webSearchTool) {
    console.warn('[Agent] 🌐 Tavily not configured. Returning fallback message.');
    return { webResults: 'Web search is not available. Please answer based on general knowledge.' };
  }

  try {
    // If the latest query is short (like just a city "Mathura" or "Yes"), combine with previous conversation topic for Tavily accuracy!
    let searchQuery = state.query;
    if (state.chatHistory && state.query.split(' ').length <= 4) {
      const historyLines = state.chatHistory.split('\n');
      const previousAiQuestion = historyLines[historyLines.length - 2] || '';
      const initialUserTopic = historyLines[historyLines.length - 3] || '';
      searchQuery = `${initialUserTopic} ${previousAiQuestion} ${state.query}`;
      console.log(`[Agent] 🌐 Contextualized short web search query: "${searchQuery}"`);
    }

    // FIX: Call Tavily passing an object with "query" property as expected by @langchain/tavily Zod schema
    const searchResults = await webSearchTool.invoke({ query: searchQuery });

    console.log('[Agent] 🌐 Web search completed. Results received.');

    // Convert output to clean text if Tavily returned a JSON object/array
    const resultText = typeof searchResults === 'string'
      ? searchResults
      : JSON.stringify(searchResults, null, 2);

    return { webResults: resultText };
  } catch (error) {
    console.error(`[Agent] 🌐 Web search failed: ${error.message}`);
    return { webResults: 'Web search failed or timed out. Please answer using your built-in General Knowledge.' };
  }
};

// ============================================================
// NODE 5: QUERY REWRITE NODE
// ============================================================
//
// This node runs when the Grade Documents Node says:
// "The retrieved chunks are NOT relevant to the question."
//
// Its job: Take the user's original question and REWRITE it
// using better, more specific keywords so that the NEXT
// search attempt returns more relevant results.
//
// Example:
//   Original: "Tell me about his work"
//   Rewritten: "Rudra Agrawal software development internship 
//               experience work history GLA University"
//
// After rewriting, the state.query is updated with the new query,
// and the graph loops BACK to the Retrieve Node for another try.

const queryRewriteNode = async (state) => {
  console.log('[Agent] ✏️ Query Rewrite Node: Improving search query...');

  const rewritePrompt = [
    new SystemMessage(
      `You are a query rewriter for a search engine.
      The original query did not return good results from the document database.
      
      Your job: Rewrite the query to be more specific and use better keywords
      that are more likely to match text in uploaded documents (like resumes, 
      reports, or technical documents). Use the conversation context to guide the keywords!
      
      RESPOND WITH ONLY THE REWRITTEN QUERY. No explanation.`
    ),
    new HumanMessage(
      `${state.chatHistory ? `RECENT CONVERSATION:\n${state.chatHistory}\n\n` : ''}Original query: ${state.query}`
    )
  ];

  try {
    const rewriteResponse = await llm.invoke(rewritePrompt);
    const newQuery = rewriteResponse.content.trim();

    console.log(`[Agent] ✏️ Original: "${state.query}" → Rewritten: "${newQuery}"`);

    // Update the query in state — next time Retrieve Node runs,
    // it will use this improved query!
    return { query: newQuery };
  } catch (error) {
    console.error(`[Agent Error] ✏️ Query Rewrite Node LLM failed: ${error.message}`);
    return { query: state.query }; // Keep original query on error
  }
};

// ============================================================
// NODE 6: GENERATE NODE (Final Answer with Dynamic Personas!)
// ============================================================
//
// This is the LAST node in every path. Instead of forcing one
// rigid strict prompt on every interaction, it intelligently gives
// Gemini a different PERSONA based on which path was taken!

const generateNode = async (state) => {
  console.log('[Agent] 🤖 Generate Node: Creating final answer with Gemini...');

  let systemInstructionText = '';

  // Case 1: Direct Chat (General Knowledge)
  if (state.route === 'direct_chat') {
    console.log('[Agent] 🤖 Mode: Direct Chat. Generating conversational response.');
    systemInstructionText = `You are a highly intelligent, friendly, and articulate AI assistant built by Rudra Agrawal.
Start your response with this prefix on its own line: "(💬 Answering via General Knowledge & Chat)"

CRITICAL FORMATTING RULES:
1. Use rich Markdown formatting (bolding, italics, bullet points, headers).
2. Structure your answer beautifully with clear paragraphs.
3. Use relevant emojis 🚀 to make the text engaging and professional.
4. Keep the tone premium, confident, and highly helpful.
    
Then respond conversationally and naturally to the user's message without mentioning document retrieval.`;
  }
  // Case 2: Web Search (Live Internet Data)
  else if (state.route === 'web_search' || (state.webResults && state.webResults.length > 0)) {
    console.log('[Agent] 🤖 Mode: Web Search. Using live internet results as context.');
    const webData = state.webResults || 'No web data returned.';
    systemInstructionText = `You are a modern AI research assistant equipped with real-time web search capabilities.
Start your answer with this prefix on its own line: "(🌐 Live Web Search: Information retrieved from the real-time internet via Tavily)"

CRITICAL FORMATTING RULES:
1. Use rich Markdown formatting (bolding, bullet points, numbered lists).
2. Structure your answer beautifully with clear headers (###).
3. Use relevant emojis to make the text engaging.
4. Keep the tone premium, confident, and highly informative.

Then answer the user's question clearly using the provided live Web Search Results below.
    
LIVE WEB SEARCH RESULTS:
${webData}`;
  }
  // Case 3: Document Search (RAG Strict Mode)
  else {
    console.log(`[Agent] 🤖 Mode: Document Search. Using ${state.documents ? state.documents.length : 0} PDF chunks as context.`);
    const docContext = (state.documents && state.documents.length > 0)
      ? state.documents.map(doc => doc.content).join('\n\n---\n\n')
      : 'No matching document chunks found in database.';

    systemInstructionText = `You are an elite, highly intelligent RAG (Retrieval-Augmented Generation) assistant.
Start your answer with this prefix on its own line: "(📑 Verified Document Match: Answering based on your uploaded PDF database & General Knowledge)"

CRITICAL FORMATTING RULES:
1. Use rich Markdown formatting (bolding for key terms, bullet points for lists, and code blocks if applicable).
2. Structure your answer beautifully with clear headers (###) to separate concepts.
3. Use relevant emojis 📚 to make the text engaging and easy to read.
4. Provide comprehensive, detailed, and deeply technical explanations when required. 
5. Do NOT write flat, boring paragraphs. Break down information visually!

Then answer the user's question. First, use the provided DOCUMENT CONTEXT below.
If the DOCUMENT CONTEXT is insufficient to fully answer the question, you MUST use your own general knowledge to fully answer the user's question. Clearly distinguish what information came from the document and what you provided from general knowledge.

DOCUMENT CONTEXT:
${docContext}`;
  }

  // Build the final prompt for Gemini with conversational memory and dynamic system instruction!
  const generatePrompt = [
    new SystemMessage(systemInstructionText),
    new HumanMessage(
      `${state.chatHistory ? `RECENT CONVERSATION HISTORY:\n${state.chatHistory}\n\n` : ''}LATEST USER QUESTION: ${state.originalQuery || state.query}`
    )
  ];

  try {
    // Call Gemini to generate the final answer
    const llmResponse = await llm.invoke(generatePrompt);
    const answer = llmResponse.content;

    console.log('[Agent] 🤖 Answer generated successfully.');

    return { answer };
  } catch (error) {
    console.error(`[Agent Error] 🤖 Generate Node LLM failed: ${error.message}`);
    return { answer: "⚠️ **System Overloaded**: The AI system is currently experiencing high load or API rate limits. Please wait a few seconds and try your request again." };
  }
};

// ============================================================
// STEP 3d: GRAPH CONSTRUCTION (Wiring Nodes & Edges)
// ============================================================
//
// Now we put everything together into a cohesive flowchart/graph!
// We define nodes, draw lines (edges) between them, and compile
// the workflow into an executable AI agent.

console.log('[Agent] ⚙️ Building LangGraph Workflow...');

// 1. Initialize the StateGraph with our defined State structure
const workflow = new StateGraph({ channels: graphState })

  // 2. Add all 6 nodes to our map
  .addNode('router', routerNode)
  .addNode('retrieve', retrieveNode)
  .addNode('grade_documents', gradeDocumentsNode)
  .addNode('web_search', webSearchNode)
  .addNode('query_rewrite', queryRewriteNode)
  .addNode('generate', generateNode)

  // 3. Set the STARTING point (Entry Node)
  // Whenever a question arrives, it ALWAYS goes to 'router' first
  .addEdge('__start__', 'router')

  // 4. Conditional Edges from Router
  // Router decides where to go based on state.route ("document_search", "web_search", or "direct_chat")
  .addConditionalEdges(
    'router',
    (state) => {
      if (state.route === 'web_search') return 'web_search';
      if (state.route === 'direct_chat') return 'direct_chat';
      return 'document_search'; // Default to document search
    },
    {
      document_search: 'retrieve',
      web_search: 'web_search',
      direct_chat: 'generate'
    }
  )

  // 5. Normal Edge: After retrieving chunks, ALWAYS grade their relevance
  .addEdge('retrieve', 'grade_documents')

  // 6. Conditional Edges from Grader
  // Grader decides if we can generate, if we must rewrite, or fallback to web search
  .addConditionalEdges(
    'grade_documents',
    (state) => {
      if (state.route === 'generate') return 'generate';
      if (state.route === 'web_search') return 'web_search';
      return 'rewrite';
    },
    {
      generate: 'generate',
      rewrite: 'query_rewrite',
      web_search: 'web_search'
    }
  )

  // 7. Loopback Edge: After rewriting the query, go BACK to retrieve node with the better query!
  .addEdge('query_rewrite', 'retrieve')

  // 8. Normal Edge: After web search finishes, go straight to generating the final answer
  .addEdge('web_search', 'generate')

  // 9. Normal Edge: After generating the answer, END the workflow!
  .addEdge('generate', END);

// 10. Compile the graph into a runnable agent!
const ragAgent = workflow.compile();

console.log('[Agent] ✅ LangGraph RAG Agent compiled successfully and ready!');

// Export the compiled Agent as our primary export
export { ragAgent, graphState };

