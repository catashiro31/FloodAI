// Backend API Configuration
const FALLBACK_BACKEND_URL = 'http://localhost:5000';
const BACKEND_URL =
    window.FLOODGUARD_BACKEND_URL ||
    (window.location.protocol.startsWith('http')
        ? `${window.location.protocol}//${window.location.hostname}:5000`
        : FALLBACK_BACKEND_URL);

// Initialize Socket.io
let socket;
if (typeof io !== 'undefined') {
    socket = io(BACKEND_URL);
} else {
    socket = { on: () => {}, emit: () => {}, id: 'mock-id' };
}

// State
let activeView = 'analysis';
let currentTheme = localStorage.getItem('theme') || 'light';
let sessionId = localStorage.getItem('session_id') || "";
let currentJobId = localStorage.getItem('current_job_id') || "";
let sessions = [];

if (!sessionId) {
    sessionId = typeof crypto !== 'undefined' ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    localStorage.setItem('session_id', sessionId);
}

let analysisMessages = [
  {
    id: "1",
    sender: "bot",
    text: "Hello. I am ready to analyze your site. Please describe the water levels or affected structures for a precise assessment.",
    createdAt: Date.now(),
    imageUrls: []
  }
];

let selectedFiles = [];
const MAX_SELECTED_FILES = 6;

// DOM Elements
const analysisViewEl = document.getElementById('analysis-view');
const dashboardViewEl = document.getElementById('dashboard-view');
const analysisChatHistoryEl = document.getElementById('analysis-chat-history');
const analysisChatInputEl = document.getElementById('analysis-chat-input');
const analysisSendBtnEl = document.getElementById('analysis-send-btn');
const analysisUploadTriggerEl = document.getElementById('analysis-upload-trigger');
const analysisFileInputEl = document.getElementById('analysis-file-input');
const analysisPreviewsEl = document.getElementById('analysis-previews');
const themeToggleEl = document.getElementById('theme-toggle');
const themeToggleIconEl = document.getElementById('theme-toggle-icon');
const newSessionBtnEl = document.getElementById('new-session-btn');
const sessionListEl = document.getElementById('session-list');

// Socket Events
socket.on('connect', () => {
    console.log('Connected to WebSocket server');
    if (sessionId) {
        socket.emit('registerSession', { sessionId });
    }
});

socket.on('uploadStatus', (data) => {
    const lastBotMsg = [...analysisMessages].reverse().find(m => m.sender === 'bot');
    if (lastBotMsg) {
        lastBotMsg.text = `Neural Analysis: ${data.status}...`;
        renderAnalysisMessages();
    }
});

socket.on('receiveMessage', (data) => {
    if (data.jobId) {
        currentJobId = data.jobId;
        localStorage.setItem('current_job_id', currentJobId);
    }

    const lastBotMsg = [...analysisMessages].reverse().find(m => m.sender === 'bot' && (m.text === "Thinking..." || m.text.includes("Neural Analysis")));
    
    if (lastBotMsg) {
        lastBotMsg.text = data.reply;
        lastBotMsg.imageUrls = data.imageUrls || [];
        lastBotMsg.createdAt = data.createdAt ? new Date(data.createdAt).getTime() : Date.now();
    } else {
        analysisMessages.push({
            id: Date.now().toString(),
            sender: 'bot',
            text: data.reply,
            createdAt: data.createdAt ? new Date(data.createdAt).getTime() : Date.now(),
            imageUrls: data.imageUrls || []
        });
    }
    renderAnalysisMessages(true);
    fetchSessions(); // Refresh session list to show last message
});

// Functions
async function fetchSessions() {
    try {
        const res = await fetch(`${BACKEND_URL}/chat/sessions?limit=20`);
        if (res.ok) {
            const data = await res.json();
            sessions = data.sessions || [];
            renderSessionList();
        }
    } catch (err) {
        console.error('Failed to fetch sessions:', err);
    }
}

function renderSessionList() {
    if (!sessionListEl) return;
    
    if (sessions.length === 0) {
        sessionListEl.innerHTML = '<div class="px-3 py-2 text-xs text-ui-muted/40 italic">No recent sessions</div>';
        return;
    }

    sessionListEl.innerHTML = sessions.map(s => {
        const isActive = s.sessionId === sessionId;
        const lastMsg = s.lastReply || s.lastQuestion || "New conversation";
        const time = s.updatedAt ? formatRelativeTime(new Date(s.updatedAt).getTime()) : "";

        return `
            <div onclick="loadSessionHistory('${s.sessionId}')" class="group relative flex flex-col gap-1 rounded-lg px-3 py-2.5 transition-all cursor-pointer ${isActive ? 'bg-brand-primary/10 border-l-2 border-brand-primary' : 'hover:bg-white/5'}">
                <div class="flex items-center justify-between">
                    <span class="text-[11px] font-bold tracking-tight ${isActive ? 'text-brand-primary' : 'text-ui-text'} truncate w-32">
                        ${s.sessionId.substring(0, 8)}...
                    </span>
                    <span class="text-[9px] font-medium text-ui-muted opacity-60">${time}</span>
                </div>
                <p class="text-[10px] leading-tight text-ui-muted truncate opacity-80 group-hover:opacity-100">
                    ${lastMsg}
                </p>
            </div>
        `;
    }).join('');
}

async function loadSessionHistory(id) {
    if (!id) return;
    
    // Set active session
    sessionId = id;
    localStorage.setItem('session_id', id);
    socket.emit('registerSession', { sessionId });
    renderSessionList();

    try {
        const res = await fetch(`${BACKEND_URL}/chat/sessions/${id}`);
        if (res.ok) {
            const data = await res.json();
            const dbSession = data.session;
            
            // Map history to analysisMessages
            if (dbSession && dbSession.history) {
                analysisMessages = dbSession.history.map((h, i) => ({
                    id: i.toString(),
                    sender: h.role === 'user' ? 'user' : 'bot',
                    text: h.content,
                    createdAt: h.createdAt ? new Date(h.createdAt).getTime() : Date.now(),
                    imageUrls: [] // Current schema doesn't store image history per message easily
                }));

                // If the session has a lastReply and it matches a task, we could potentially fetch more
                // But for now, we just use the history array.
                
                renderAnalysisMessages(true);
            }
        }
    } catch (err) {
        console.error('Failed to load history:', err);
    }
}

function formatRelativeTime(createdAt) {
    const diffMs = Math.max(0, Date.now() - createdAt);
    const diffMinutes = Math.floor(diffMs / 60000);
    if (diffMinutes === 0) return 'Just now';
    if (diffMinutes === 1) return '1 min ago';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return new Date(createdAt).toLocaleDateString();
}

function switchView(view) {
    activeView = view;
    
    if (view === 'analysis') {
        analysisViewEl.classList.remove('hidden');
        analysisViewEl.classList.add('flex');
        dashboardViewEl.classList.add('hidden');
        renderAnalysisMessages();
    } else {
        analysisViewEl.classList.add('hidden');
        analysisViewEl.classList.remove('flex');
        dashboardViewEl.classList.remove('hidden');
        dashboardViewEl.classList.add('flex');
    }
}

function toggleTheme() {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    applyTheme();
}

function applyTheme() {
    document.documentElement.setAttribute('data-theme', currentTheme);
    localStorage.setItem('theme', currentTheme);
}

function createNewSession() {
    sessionId = typeof crypto !== 'undefined' ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    localStorage.setItem('session_id', sessionId);
    currentJobId = '';
    localStorage.removeItem('current_job_id');
    socket.emit('registerSession', { sessionId });
    analysisMessages = [
        {
            id: "1",
            sender: "bot",
            text: "Ready for new impact assessment. (New Session Started)",
            createdAt: Date.now(),
            imageUrls: []
        }
    ];
    clearSelectedFiles();
    renderAnalysisMessages(true);
    fetchSessions();
}

function renderAnalysisMessages(scrollToBottom = false) {
    if (!analysisChatHistoryEl) return;
    analysisChatHistoryEl.innerHTML = analysisMessages.map(msg => {
        const safeText = (msg.text || '').trim();
        const hasText = safeText.length > 0;
        const hasImages = msg.imageUrls && msg.imageUrls.length > 0;
        const imageColsClass = msg.imageUrls && msg.imageUrls.length > 1 ? 'grid-cols-2' : 'grid-cols-1';
        const authorLabel = msg.sender === "bot" ? "Neural Engine" : "Field Agent";

        const textHtml = hasText
            ? `<div class="rounded-2xl p-5 shadow-sm ${msg.sender === "bot" ? "rounded-bl-none glass-panel" : "chat-bubble-user"}">
                    <p class="text-sm font-medium leading-relaxed">${safeText.replace(/\n/g, '<br>')}</p>
               </div>`
            : '';

        const imagesHtml = hasImages
            ? `<div class="${hasText ? "mt-4 " : ""}grid ${imageColsClass} gap-3">
                    ${msg.imageUrls.map(url => `<img src="${url}" class="h-64 w-full rounded-2xl border border-white/10 object-cover shadow-2xl" />`).join('')}
               </div>`
            : '';

        const iconPath = msg.sender === "bot" ? "assets/icons/bot-message-square.svg" : "assets/icons/activity.svg";

        return `
            <div class="flex gap-5 ${msg.sender === "user" ? "flex-row-reverse" : ""} animate-slide-up">
                <div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${msg.sender === "bot" ? "bg-brand-primary/10 text-brand-primary" : "bg-white/5 text-ui-muted"}">
                    <span class="icon-custom w-5 h-5" style="-webkit-mask-image: url('${iconPath}'); mask-image: url('${iconPath}');"></span>
                </div>
                <div class="max-w-[80%]">
                    ${textHtml}
                    ${imagesHtml}
                    <p class="mt-3 px-1 text-[10px] font-black uppercase tracking-[0.2em] text-ui-muted/60 ${msg.sender === "user" ? "text-right" : ""}">
                        ${authorLabel} • ${formatRelativeTime(msg.createdAt || Date.now())}
                    </p>
                </div>
            </div>
        `;
    }).join('');
    if (scrollToBottom) {
        analysisChatHistoryEl.scrollTop = analysisChatHistoryEl.scrollHeight;
    }
}

function isImageFile(file) {
    return Boolean(file && typeof file.type === 'string' && file.type.startsWith('image/'));
}

function getFileKey(file) {
    return `${file.name}_${file.size}_${file.lastModified}`;
}

function appendSelectedFiles(files) {
    const incoming = files.filter(isImageFile);
    if (incoming.length === 0) return;

    const seen = new Set(selectedFiles.map(getFileKey));
    for (const file of incoming) {
        const key = getFileKey(file);
        if (seen.has(key)) continue;
        if (selectedFiles.length >= MAX_SELECTED_FILES) break;
        selectedFiles.push(file);
        seen.add(key);
    }
    renderSelectedPreviews();
}

function clearSelectedFiles() {
    selectedFiles = [];
    if (analysisPreviewsEl) analysisPreviewsEl.innerHTML = '';
    if (analysisFileInputEl) analysisFileInputEl.value = '';
}

function renderSelectedPreviews() {
    if (!analysisPreviewsEl) return;
    analysisPreviewsEl.innerHTML = selectedFiles.map((file, index) => `
        <div class="relative h-20 w-20 overflow-hidden rounded-xl border border-white/10 shadow-xl group">
            <img src="${URL.createObjectURL(file)}" class="h-full w-full object-cover transition-transform group-hover:scale-110" />
            <button type="button" data-remove-index="${index}" class="preview-remove-btn absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black text-white opacity-0 transition-opacity group-hover:opacity-100" aria-label="Remove image">×</button>
        </div>
    `).join('');
}

function handleGlobalPaste(event) {
    if (activeView !== 'analysis') return;

    const target = event.target;
    const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target && target.isContentEditable);

    if (isEditable && target !== analysisChatInputEl) return;

    const clipboardItems = Array.from(event.clipboardData?.items || []);
    const pastedImages = clipboardItems
        .filter(item => item.kind === 'file')
        .map(item => item.getAsFile())
        .filter(isImageFile);

    if (pastedImages.length === 0) return;

    event.preventDefault();
    appendSelectedFiles(pastedImages);
}

async function handleSendMessage() {
    const text = analysisChatInputEl.value.trim();
    const filesToSend = [...selectedFiles];
    
    if (filesToSend.length === 0 && !text) return;
    
    analysisChatInputEl.value = '';
    clearSelectedFiles();

    // Add User Message
    analysisMessages.push({
        id: Date.now().toString(),
        sender: 'user',
        text: text || (filesToSend.length > 0 ? "Analyzing visual data..." : ""),
        createdAt: Date.now(),
        imageUrls: filesToSend.map(file => URL.createObjectURL(file))
    });
    renderAnalysisMessages(true);

    // Add Bot Loading Message
    const botMsgId = (Date.now() + 1).toString();
    analysisMessages.push({
        id: botMsgId,
        sender: 'bot',
        text: "Thinking...",
        createdAt: Date.now(),
        imageUrls: []
    });
    renderAnalysisMessages(true);

    if (filesToSend.length === 0) {
        socket.emit('sendMessage', {
            message: text,
            jobId: currentJobId || undefined,
            sessionId: sessionId
        });
    } else {
        try {
            for (const file of filesToSend) {
                const formData = new FormData();
                formData.append('file', file);
                formData.append('question', text || '');
                
                const uploadRes = await fetch(`${BACKEND_URL}/chat/upload`, {
                    method: 'POST',
                    headers: {
                        'x-client-id': socket.id,
                        'x-session-id': sessionId
                    },
                    body: formData
                });
                
                if (uploadRes.ok) {
                    const uploadData = await uploadRes.json();
                    if (uploadData.jobId) {
                        currentJobId = uploadData.jobId;
                        localStorage.setItem('current_job_id', currentJobId);
                    }
                    if (uploadData.sessionId) {
                        sessionId = uploadData.sessionId;
                        localStorage.setItem('session_id', sessionId);
                        socket.emit('registerSession', { sessionId });
                    }
                }
            }
            fetchSessions();
        } catch (error) {
            console.error('Pipeline error:', error);
        }
    }
}

// Event Listeners
analysisSendBtnEl?.addEventListener('click', handleSendMessage);
analysisChatInputEl?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSendMessage();
});
analysisUploadTriggerEl?.addEventListener('click', () => analysisFileInputEl?.click());
analysisFileInputEl?.addEventListener('change', (e) => {
    appendSelectedFiles(Array.from(e.target.files || []));
    analysisFileInputEl.value = '';
});
analysisPreviewsEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-index]');
    if (!btn) return;
    const index = Number(btn.getAttribute('data-remove-index'));
    if (!Number.isInteger(index) || index < 0 || index >= selectedFiles.length) return;
    selectedFiles.splice(index, 1);
    renderSelectedPreviews();
});
document.addEventListener('paste', handleGlobalPaste);

themeToggleEl?.addEventListener('click', toggleTheme);
newSessionBtnEl?.addEventListener('click', createNewSession);

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    switchView('analysis');
    
    // Load initial data
    if (sessionId) {
        loadSessionHistory(sessionId);
    }
    fetchSessions();
});

// Global Scope
window.switchView = switchView;
window.loadSessionHistory = loadSessionHistory;
