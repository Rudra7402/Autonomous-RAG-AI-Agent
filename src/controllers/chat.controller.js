import { ragAgent } from '../agent/rag.agent.js';
import { getCachedResponse, setCachedResponse } from '../services/cache.service.js';
import { ChatSession } from '../models/session.model.js';
import { DocumentChunk } from '../models/document.model.js';

/**
 * Controller: Handle RAG Chat Inquiries via LangGraph Agent
 * Endpoint: POST /api/chat
 * 
 * Flow:
 * 1. Check Redis Cache for an immediate answer.
 * 2. Retrieve past conversation history from MongoDB (tied to user & session).
 * 3. INVOKE LANGGRAPH AGENT (Router → Retrieve/Tavily → Grade → Generate).
 * 4. Save the new conversation turn to MongoDB.
 * 5. Cache the new answer in Redis and return it to the user.
 */
export const chatController = async (req, res) => {
  try {
    const { sessionId, query, fileNameFilter } = req.body;
    const userId = req.user?.userId || 'anonymous';

    if (!sessionId || !query) {
      return res.status(400).json({ error: 'Missing required fields: sessionId, query' });
    }

    // =========================================================================
    // STEP 1: Check Redis Cache (Fast path)
    // =========================================================================
    const cachedData = await getCachedResponse(query, fileNameFilter);
    if (cachedData) {
      return res.status(200).json({
        answer: cachedData.answer,
        citations: cachedData.citations || [],
        route_taken: cachedData.route_taken || 'redis_cache',
        execution_note: cachedData.execution_note || "⚡ Instant Response served directly from Redis Cache (Memory).",
        source: 'redis_cache' // Lets frontend know this was an instant response
      });
    }

    // =========================================================================
    // STEP 2: Retrieve Conversation History (Memory & ChatGPT Isolation)
    // =========================================================================
    let session = await ChatSession.findOne({ sessionId });
    if (!session) {
      const derivedTitle = query.length > 35 ? query.substring(0, 35) + '...' : query;
      session = new ChatSession({
        sessionId,
        userId,
        title: derivedTitle,
        messages: [],
        metadata: { fileNameFilter: fileNameFilter || null, userId }
      });
    } else if (session.userId === 'anonymous' && userId !== 'anonymous') {
      // Attach session to logged-in user if previously anonymous
      session.userId = userId;
    }

    // =========================================================================
    // STEP 3: INVOKE LANGGRAPH AUTONOMOUS AGENT (The Brain!) 🧠
    // =========================================================================
    console.log(`\n[Chat Controller] 🚀 Handing off query to LangGraph Agent for session: ${sessionId}...`);

    // Build conversational memory string from last 6 turns so LLM never forgets context or topic!
    const recentHistory = (session.messages || []).slice(-6).map(m => 
      `${m.role === 'ai' ? 'ASSISTANT' : m.role.toUpperCase()}: ${m.content}`
    ).join('\n');

    const agentResponse = await ragAgent.invoke({
      query: query,
      originalQuery: query,
      chatHistory: recentHistory, // Conversational Memory injected into Agent brain!
      sessionId: sessionId, // Chat-Scoped Knowledge passed directly to Agent!
      fileNameFilter: fileNameFilter || null,
      documents: [],
      webResults: '',
      answer: '',
      route: '',
      retryCount: 0
    });

    const answerText = agentResponse.answer;

    // Extract citations with ACTUAL TEXT SNIPPETS so the frontend drawer shows real useful content!
    const citations = agentResponse.documents && Array.isArray(agentResponse.documents)
      ? agentResponse.documents.map(chunk => ({
          ...chunk.metadata,
          snippet: chunk.content ? chunk.content.trim() : 'No snippet text available.'
        }))
      : [];

    // Identify which route the agent used to inform our client
    const routeUsed = agentResponse.route || 'langgraph_agent';

    // Build user-friendly explanation badge for UI & transparency
    const statusNoteMap = {
      document_search: "📑 Verified match! Retrieved & verified relevant chunks from your PDF documents via Cohere Reranking.",
      web_search: "🌐 Switched to Live Web Search via Tavily (information not in uploaded documents or requires real-time data).",
      direct_chat: "💬 Conversational mode active. Answered using built-in General Knowledge without searching documents.",
      langgraph_agent: "🚀 Answered via intelligent LangGraph Agent routing."
    };
    const executionNote = statusNoteMap[routeUsed] || statusNoteMap.langgraph_agent;

    // =========================================================================
    // STEP 4: Save History to MongoDB & Cache to Redis
    // =========================================================================
    
    // Push the user's question and AI's answer into the MongoDB session array
    session.messages.push({ role: 'user', content: query });
    session.messages.push({ role: 'ai', content: answerText, contextUsed: citations });
    await session.save();

    const responsePayload = {
      answer: answerText,
      citations: citations,
      route_taken: routeUsed, // Notice: we return WHICH route the agent decided to use!
      execution_note: executionNote, // Notice: Clean UI status badge for transparent UX!
      source: 'langgraph_agent'
    };

    // Save this exact query and answer to Redis for 1 hour
    await setCachedResponse(query, responsePayload, fileNameFilter);

    // Finally, send the intelligent response back!
    return res.status(200).json(responsePayload);

  } catch (error) {
    console.error(`[Chat Controller Error]: ${error.message}`);
    return res.status(500).json({
      error: 'Failed to process chat query via LangGraph Agent.',
      details: error.message
    });
  }
};

/**
 * Controller: Get List of User's Chat Conversations (ChatGPT Sidebar!)
 * Endpoint: GET /api/chat/sessions
 */
export const getChatSessionsController = async (req, res) => {
  try {
    const userId = req.user?.userId || 'anonymous';
    const sessions = await ChatSession.find({ userId })
      .select('sessionId title createdAt updatedAt')
      .sort({ updatedAt: -1 });

    return res.status(200).json({
      count: sessions.length,
      sessions
    });
  } catch (error) {
    console.error(`[Get Sessions Error]: ${error.message}`);
    return res.status(500).json({ error: 'Failed to retrieve chat sessions.', details: error.message });
  }
};

/**
 * Controller: Get Full Conversation Messages for a Specific Chat Thread
 * Endpoint: GET /api/chat/sessions/:sessionId
 */
export const getSessionHistoryController = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await ChatSession.findOne({ sessionId });

    if (!session) {
      return res.status(404).json({ error: `Session '${sessionId}' not found.` });
    }

    const attachedFiles = await DocumentChunk.distinct('metadata.fileName', { 'metadata.sessionId': sessionId });

    return res.status(200).json({
      sessionId: session.sessionId,
      title: session.title,
      userId: session.userId,
      messageCount: session.messages.length,
      messages: session.messages,
      attachedFiles: attachedFiles || []
    });
  } catch (error) {
    console.error(`[Get Session History Error]: ${error.message}`);
    return res.status(500).json({ error: 'Failed to retrieve conversation history.', details: error.message });
  }
};

/**
 * Controller: Delete a specific Chat Session
 * Endpoint: DELETE /api/chat/sessions/:sessionId
 */
export const deleteSessionController = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const result = await ChatSession.deleteOne({ sessionId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: `Session '${sessionId}' not found or already deleted.` });
    }

    // CRITICAL: Clean up all orphaned vector chunks uploaded within this chat session!
    const chunkCleanup = await DocumentChunk.deleteMany({ 'metadata.sessionId': sessionId });
    console.log(`[Delete Session] Cleaned up ${chunkCleanup.deletedCount} orphaned vector chunks for session ${sessionId}.`);

    return res.status(200).json({ message: `Session '${sessionId}' deleted successfully.` });
  } catch (error) {
    console.error(`[Delete Session Error]: ${error.message}`);
    return res.status(500).json({ error: 'Failed to delete session.', details: error.message });
  }
};
