/**
 * RAG Autonomous Studio — Frontend Controller
 * Connects directly to backend enterprise APIs (Auth, BullMQ Ingestion, LangGraph Routing)
 */

// Global App State
let appState = {
  currentSessionId: 'general_session_' + Math.floor(Math.random() * 10000),
  jwtToken: localStorage.getItem('rag_token') || null,
  userName: localStorage.getItem('rag_user') || 'Locked (Login Required)'
};

// DOM Elements Reference
const DOM = {
  authStatus: document.getElementById('auth-status'),
  btnShowAuth: document.getElementById('btn-show-auth'),
  btnLogout: document.getElementById('btn-logout'),
  sessionsList: document.getElementById('sessions-list'),
  sessionCount: document.getElementById('session-count'),
  btnNewChat: document.getElementById('btn-new-chat'),
  activeChatTitle: document.getElementById('active-chat-title'),
  activeSessionId: document.getElementById('active-session-id'),
  chatMessages: document.getElementById('chat-messages'),
  chatForm: document.getElementById('chat-form'),
  chatInput: document.getElementById('chat-input'),
  pdfFileInput: document.getElementById('pdf-file'),
  workerTracker: document.getElementById('worker-tracker'),
  workerJobId: document.getElementById('worker-job-id'),
  workerStatusText: document.getElementById('worker-status-text'),
  workerProgressFill: document.getElementById('worker-progress-fill'),
  authModal: document.getElementById('auth-modal'),
  btnCloseModal: document.getElementById('btn-close-modal'),
  tabLogin: document.getElementById('tab-login'),
  tabSignup: document.getElementById('tab-signup'),
  authForm: document.getElementById('auth-form'),
  fieldName: document.getElementById('field-name'),
  inputName: document.getElementById('input-name'),
  inputEmail: document.getElementById('input-email'),
  inputPassword: document.getElementById('input-password'),
  authErrorMsg: document.getElementById('auth-error-msg')
};

// =========================================================================
// 1. INITIALIZATION & AUTH STATE MANAGEMENT
// =========================================================================

function init() {
  updateAuthUI();
  
  if (!appState.jwtToken) {
    DOM.authModal.classList.remove('hidden');
    DOM.btnCloseModal.style.display = 'none'; // Force login
  }
  
  loadSessions();
  DOM.activeSessionId.textContent = `ID: ${appState.currentSessionId}`;

  // Register Event Listeners
  DOM.btnNewChat.addEventListener('click', createNewChat);
  DOM.chatForm.addEventListener('submit', handleSendChat);
  DOM.pdfFileInput.addEventListener('change', async (e) => {
    if (e.target.files.length > 0) {
      await handleUploadFile(e);
    }
  });

  // ChatGPT-style Textarea Behavior
  DOM.chatInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
    if (this.value === '') this.style.height = 'auto';
  });
  
  DOM.chatInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (this.value.trim() !== '') {
        DOM.chatForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      }
    }
  });

  // Auth UI events
  DOM.btnShowAuth.addEventListener('click', () => DOM.authModal.classList.remove('hidden'));
  DOM.btnCloseModal.addEventListener('click', () => DOM.authModal.classList.add('hidden'));
  DOM.btnLogout.addEventListener('click', handleLogout);
  DOM.tabLogin.addEventListener('click', () => switchAuthTab(false));
  DOM.tabSignup.addEventListener('click', () => switchAuthTab(true));
  DOM.authForm.addEventListener('submit', handleAuthSubmit);
}

function updateAuthUI() {
  const btnSend = document.getElementById('btn-send');
  if (appState.jwtToken) {
    DOM.authStatus.innerHTML = `👤 Mode: <strong>${appState.userName}</strong>`;
    DOM.btnShowAuth.classList.add('hidden');
    DOM.btnLogout.classList.remove('hidden');
    DOM.chatInput.disabled = false;
    DOM.chatInput.placeholder = 'Message RAG AI... (or attach a PDF)';
    if(btnSend) btnSend.disabled = false;
    DOM.pdfFileInput.disabled = false;
    DOM.btnNewChat.disabled = false;
    DOM.btnCloseModal.style.display = 'block';
  } else {
    DOM.authStatus.innerHTML = `🔒 Mode: <strong>Locked (Login Required)</strong>`;
    DOM.btnShowAuth.classList.remove('hidden');
    DOM.btnLogout.classList.add('hidden');
    DOM.chatInput.disabled = true;
    DOM.chatInput.placeholder = 'Please login to start chatting...';
    if(btnSend) btnSend.disabled = true;
    DOM.pdfFileInput.disabled = true;
    DOM.btnNewChat.disabled = true;
  }
}

function getAuthHeaders(isJson = true) {
  const headers = {};
  if (isJson) headers['Content-Type'] = 'application/json';
  if (appState.jwtToken) headers['Authorization'] = `Bearer ${appState.jwtToken}`;
  return headers;
}

// =========================================================================
// 2. CHAT SESSION MANAGEMENT (ChatGPT Style Sidebar)
// =========================================================================

async function loadSessions() {
  try {
    const res = await fetch('/api/chat/sessions', { headers: getAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    
    DOM.sessionCount.textContent = data.count || 0;
    DOM.sessionsList.innerHTML = '';

    data.sessions.forEach(sess => {
      const li = document.createElement('li');
      li.className = `session-item ${sess.sessionId === appState.currentSessionId ? 'active' : ''}`;
      li.innerHTML = `
        <span class="session-title" title="${sess.title}">💬 ${sess.title}</span>
        <button class="btn-delete-session" title="Delete Session">&times;</button>
      `;
      
      // Select chat thread
      li.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-delete-session')) {
          e.stopPropagation();
          deleteSession(sess.sessionId);
        } else {
          switchSession(sess);
        }
      });
      DOM.sessionsList.appendChild(li);
    });
  } catch (err) {
    console.warn('Failed to fetch sessions list:', err);
  }
}

function renderAttachedFiles(files) {
  const container = document.getElementById('attached-files-container');
  if (!container) return;
  container.innerHTML = '';
  if (files && files.length > 0) {
    files.forEach(fileName => appendAttachedFile(fileName, container));
  }
}

function appendAttachedFile(fileName, container = document.getElementById('attached-files-container')) {
  if (!container) return;

  // Prevent duplicate visual chips for the exact same filename
  const existingChips = container.querySelectorAll('div');
  for (let chip of existingChips) {
    if (chip.textContent.includes(fileName)) {
      return; 
    }
  }

  const chip = document.createElement('div');
  chip.innerHTML = `📄 ${escapeHtml(fileName)}`;
  chip.style.cssText = 'background: rgba(16, 185, 129, 0.1); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; display: flex; align-items: center; gap: 4px; margin-bottom: 4px; margin-right: 4px;';
  container.appendChild(chip);
}

async function switchSession(sess) {
  appState.currentSessionId = sess.sessionId;
  DOM.activeChatTitle.textContent = sess.title;
  DOM.activeSessionId.textContent = `ID: ${sess.sessionId}`;
  loadSessions(); // Re-render sidebar highlights
  
  // Fetch messages history
  try {
    const res = await fetch(`/api/chat/sessions/${sess.sessionId}`, { headers: getAuthHeaders() });
    const data = await res.json();
    
    DOM.chatMessages.innerHTML = '';
    renderAttachedFiles(data.attachedFiles || []);

    if (data.messages && data.messages.length > 0) {
      data.messages.forEach(m => {
        if (m.role === 'user') renderUserMessage(m.content);
        if (m.role === 'ai') renderAiMessage({ answer: m.content, citations: m.contextUsed, route_taken: 'historical' });
      });
    } else {
      showWelcomeBanner();
    }
  } catch (err) {
    console.error('Error loading chat messages:', err);
  }
}

function createNewChat() {
  appState.currentSessionId = 'chat_' + Date.now().toString(36);
  DOM.activeChatTitle.textContent = 'New Conversation';
  DOM.activeSessionId.textContent = `ID: ${appState.currentSessionId}`;
  DOM.chatMessages.innerHTML = '';
  renderAttachedFiles([]);
  showWelcomeBanner();
  loadSessions();
}

async function deleteSession(sessionId) {
  if (!confirm('Are you sure you want to delete this chat conversation?')) return;
  await fetch(`/api/chat/sessions/${sessionId}`, { method: 'DELETE', headers: getAuthHeaders() });
  if (appState.currentSessionId === sessionId) createNewChat();
  else loadSessions();
}

function showWelcomeBanner() {
  DOM.chatMessages.innerHTML = `
    <div class="welcome-banner">
      <h3>👋 Ready in Thread: ${appState.currentSessionId}</h3>
      <p>Ask a quick general question, test live Tavily web search, or upload a document on the left for 2-stage Cohere Rerank exploration!</p>
    </div>
  `;
}

// =========================================================================
// 3. BULLMQ WORKER SHOWCASE (Real-time File Ingestion Progress)
// =========================================================================

async function handleUploadFile(e) {
  e.preventDefault();
  const file = DOM.pdfFileInput.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('sessionId', appState.currentSessionId); // Chat-Scoped isolation!

  try {
    DOM.workerTracker.classList.remove('hidden');
    DOM.workerJobId.textContent = `Queuing...`;
    DOM.workerStatusText.textContent = `Pushing to Redis...`;
    DOM.workerProgressFill.style.width = '15%';

    const res = await fetch('/api/ingest', {
      method: 'POST',
      headers: getAuthHeaders(false),
      body: formData
    });
    const data = await res.json();

    if (res.status === 202) {
      const jobId = data.jobId;
      DOM.workerJobId.textContent = `BullMQ Job #${jobId}`;
      pollWorkerProgress(jobId);
    } else {
      alert(`Upload error: ${data.error || 'Unknown problem'}`);
    }
  } catch (err) {
    console.error('Upload exception:', err);
    alert('Failed to connect to backend server for ingestion.');
  }
}

function pollWorkerProgress(jobId) {
  const interval = setInterval(async () => {
    try {
      const res = await fetch(`/api/ingest/status/${jobId}`, { headers: getAuthHeaders() });
      const data = await res.json();

      DOM.workerStatusText.textContent = `Status: ${data.status.toUpperCase()}`;
      
      let prog = parseInt(data.progress) || 20;
      if (data.status === 'completed') prog = 100;
      DOM.workerProgressFill.style.width = `${prog}%`;

      if (data.status === 'completed' || data.status === 'failed') {
        clearInterval(interval);
        if (data.status === 'completed') {
          DOM.workerStatusText.textContent = `✅ Complete! Embedded & Stored in Atlas`;
          DOM.workerStatusText.style.color = '#10b981';
          
          if (data.result && data.result.fileName) {
            appendAttachedFile(data.result.fileName);
          }

          setTimeout(() => {
            DOM.workerTracker.classList.add('hidden');
            DOM.pdfFileInput.value = '';
          }, 5000);
        } else {
          DOM.workerStatusText.textContent = `❌ Worker Error: ${data.error}`;
          DOM.workerStatusText.style.color = '#ef4444';
        }
      }
    } catch (e) {
      clearInterval(interval);
    }
  }, 1000); // Poll every 1 second to show live engineering action!
}

// =========================================================================
// 4. CHAT MESSAGING & ENGINEER REASONING SHOWCASE
// =========================================================================

function setUIState(isProcessing) {
  DOM.chatInput.disabled = isProcessing;
  const btnSend = DOM.chatForm.querySelector('#btn-send');
  if (btnSend) btnSend.disabled = isProcessing;
  DOM.btnNewChat.disabled = isProcessing;
  
  if (isProcessing) {
    DOM.chatForm.style.opacity = '0.6';
    DOM.chatInput.placeholder = 'AI is thinking...';
  } else {
    DOM.chatForm.style.opacity = '1';
    DOM.chatInput.placeholder = 'Message RAG AI... (or attach a PDF)';
    DOM.chatInput.focus();
  }
}

async function handleSendChat(e) {
  e.preventDefault();
  const text = DOM.chatInput.value.trim();
  if (!text) return;

  setUIState(true);

  // Clear welcome banner on first message
  const banner = document.querySelector('.welcome-banner');
  if (banner) banner.remove();

  // Render user message bubble
  renderUserMessage(text);
  DOM.chatInput.value = '';
  DOM.chatInput.style.height = 'auto'; // reset height

  // Create simple loader
  const loaderId = 'loader_' + Date.now();
  renderLoader(loaderId);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000); // 45 seconds timeout

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        sessionId: appState.currentSessionId,
        query: text
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    const loader = document.getElementById(loaderId);
    if (loader) loader.remove();

    const data = await res.json();
    if (res.ok) {
      renderAiMessage(data);
      loadSessions(); // Update sidebar list titles
    } else {
      alert(`Backend Error: ${data.error || 'Could not process query'}`);
    }
  } catch (err) {
    clearTimeout(timeoutId);
    const loader = document.getElementById(loaderId);
    if (loader) loader.remove();
    
    if (err.name === 'AbortError') {
      alert('Request Timed Out. The AI system is heavily loaded. Please try again.');
    } else {
      alert('Server unreachable. Make sure express app is running!');
    }
  } finally {
    setUIState(false);
  }
}

function renderUserMessage(text) {
  const row = document.createElement('div');
  row.className = 'message-row user-row';
  row.innerHTML = `
    <div class="avatar">U</div>
    <div class="msg-bubble">${escapeHtml(text)}</div>
  `;
  DOM.chatMessages.appendChild(row);
  scrollToBottom();
}

function renderLoader(loaderId) {
  const row = document.createElement('div');
  row.id = loaderId;
  row.className = 'message-row ai-row';
  row.innerHTML = `
    <div class="avatar">⚙️</div>
    <div class="msg-bubble" style="font-style: italic; color: var(--text-secondary);">
      🤖 LangGraph autonomous brain is analyzing route and running tools...
    </div>
  `;
  DOM.chatMessages.appendChild(row);
  scrollToBottom();
}

function renderAiMessage(data) {
  const row = document.createElement('div');
  row.className = 'message-row ai-row';

  // Determine Engineer Status Badge styling
  let badgeHtml = '';
  const route = data.route_taken || 'langgraph_agent';
  
  if (data.source === 'redis_cache' || route === 'redis_cache') {
    badgeHtml = `<div class="route-badge badge-redis">⚡ Served Instantly from Redis Cloud Cache (Memory)</div>`;
  } else if (route === 'document_search') {
    badgeHtml = `<div class="route-badge badge-doc">📑 Cohere 2-Stage Reranked Vector Document Match</div>`;
  } else if (route === 'web_search') {
    badgeHtml = `<div class="route-badge badge-web">🌐 Live Tavily AI Internet Search Activated</div>`;
  } else if (route === 'direct_chat') {
    badgeHtml = `<div class="route-badge badge-chat">💬 General Conversational Mode</div>`;
  } else if (route !== 'historical') {
    badgeHtml = `<div class="route-badge badge-chat">⚙️ Autonomous LangGraph Response</div>`;
  }

  // Format citations drawer with REAL RETRIEVED TEXT SNIPPETS so interviewers can inspect actual matching chunks!
  let citationsHtml = '';
  if (data.citations && data.citations.length > 0) {
    const citId = 'cit_' + Math.random().toString(36).substring(2);
    citationsHtml = `
      <button class="citation-toggle" onclick="document.getElementById('${citId}').classList.toggle('hidden')">
        🔍 View Source Documents & Verified Chunks (${data.citations.length} snippets) <span>▼</span>
      </button>
      <div id="${citId}" class="citations-box hidden" style="max-height: 350px; overflow-y: auto; padding: 12px; background: #080a0f;">
        ${data.citations.map((c, idx) => `
          <div style="margin-bottom: 14px; padding: 12px; background: #121722; border-radius: 8px; border: 1px solid #2e384d;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px;">
              <strong style="color: #10b981; font-size: 13px;">📄 File: ${escapeHtml(c.fileName || 'Ingested Document')}</strong>
              <span style="font-size: 11px; background: rgba(59,130,246,0.2); color: #3b82f6; padding: 2px 8px; border-radius: 12px; font-weight: 600;">Chunk #${c.chunkIndex ?? idx}</span>
            </div>
            <div style="font-size: 11px; color: #92a2bd; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Retrieved Paragraph Snippet:</div>
            <pre style="white-space: pre-wrap; word-break: break-word; font-family: 'Consolas', 'Courier New', monospace; font-size: 12px; color: #e5e7eb; background: #0c0f17; padding: 10px; border-radius: 6px; border: 1px solid #1f2937; margin: 0; max-height: 150px; overflow-y: auto;">${escapeHtml(c.snippet || 'Text verified by Cohere cross-encoder.')}</pre>
          </div>
        `).join('')}
      </div>
    `;
  }

  // Parse Markdown and Apply Syntax Highlighting to Code Blocks
  marked.setOptions({
    highlight: function(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    },
    langPrefix: 'hljs language-',
    breaks: true, // Render line breaks automatically
    gfm: true // GitHub Flavored Markdown
  });
  
  const formattedAnswer = marked.parse(data.answer || '');

  row.innerHTML = `
    <div class="avatar">AI</div>
    <div class="msg-bubble">
      ${badgeHtml}
      <div class="answer-text">${formattedAnswer}</div>
      ${citationsHtml}
    </div>
  `;
  DOM.chatMessages.appendChild(row);
  scrollToBottom();
}

function scrollToBottom() {
  DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// =========================================================================
// 5. AUTH MODAL & SUBMISSION HANDLERS
// =========================================================================

let isSignupMode = false;

function switchAuthTab(signup) {
  isSignupMode = signup;
  if (signup) {
    DOM.tabSignup.classList.add('active');
    DOM.tabLogin.classList.remove('active');
    DOM.fieldName.classList.remove('hidden');
    document.getElementById('modal-title').textContent = '📝 Register Engineer Account';
  } else {
    DOM.tabLogin.classList.add('active');
    DOM.tabSignup.classList.remove('active');
    DOM.fieldName.classList.add('hidden');
    document.getElementById('modal-title').textContent = '🔐 Engineer Login';
  }
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  DOM.authErrorMsg.classList.add('hidden');

  const email = DOM.inputEmail.value.trim();
  const password = DOM.inputPassword.value.trim();
  const name = DOM.inputName.value.trim();

  const url = isSignupMode ? '/api/auth/signup' : '/api/auth/login';
  const payload = isSignupMode ? { name, email, password } : { email, password };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (res.ok) {
      localStorage.setItem('rag_token', data.token);
      localStorage.setItem('rag_user', data.user.name);
      appState.jwtToken = data.token;
      appState.userName = data.user.name;
      
      updateAuthUI();
      DOM.authModal.classList.add('hidden');
      loadSessions();
    } else {
      DOM.authErrorMsg.textContent = data.error || 'Authentication failed.';
      DOM.authErrorMsg.classList.remove('hidden');
    }
  } catch (err) {
    DOM.authErrorMsg.textContent = 'Server unreachable. Try again later.';
    DOM.authErrorMsg.classList.remove('hidden');
  }
}

function handleLogout() {
  localStorage.removeItem('rag_token');
  localStorage.removeItem('rag_user');
  appState.jwtToken = null;
  appState.userName = 'Locked (Login Required)';
  updateAuthUI();
  DOM.authModal.classList.remove('hidden');
  DOM.btnCloseModal.style.display = 'none';
  createNewChat();
}

// Kickstart Application
document.addEventListener('DOMContentLoaded', init);
