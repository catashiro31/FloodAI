// Backend API Configuration
const FALLBACK_BACKEND_URL = 'http://localhost:5000';
const BACKEND_URL =
    window.FLOODGUARD_BACKEND_URL ||
    (window.location.protocol.startsWith('http')
        ? `${window.location.protocol}//${window.location.hostname}:5000`
        : FALLBACK_BACKEND_URL);

// Helper: chuyển đổi đường dẫn /static/... thành URL đầy đủ
function resolveImageUrl(url) {
    if (!url) return '';
    if (typeof url !== 'string') return url;
    if (url.startsWith('/static/')) return `${BACKEND_URL}${url}`;
    return url;
}

function normalizeText(value, fallback = '') {
    return typeof value === 'string' ? value : fallback;
}

function escapeHtml(value) {
    return normalizeText(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
}

function toMetricNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function isProcessingTaskStatus(status) {
    return ['queued', 'processing_segmentation', 'processing_vlm'].includes(normalizeText(status).trim());
}

function hasTaskImage(task) {
    return Boolean(task && (task.image_url || task.imageUrl));
}

function hasTaskMask(task) {
    return Boolean(task && (task.mask_all_overlay || task.maskAllOverlay || task.mask_url || task.maskUrl));
}

function isInterimReplyText(reply) {
    return normalizeText(reply).trim().startsWith('⏳');
}

function normalizeImageUrls(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((item) => resolveImageUrl(normalizeText(item).trim()))
        .filter(Boolean);
}

function findLastBotPlaceholderIndex() {
    for (let i = analysisMessages.length - 1; i >= 0; i -= 1) {
        const message = analysisMessages[i];
        if (
            message?.sender === 'bot' &&
            (message.text === 'Đang suy nghĩ...' || normalizeText(message.text).includes('⏳') || normalizeText(message.text).includes('Pipeline'))
        ) {
            return i;
        }
    }
    return -1;
}

// Initialize Socket.io
let socket;
if (typeof io !== 'undefined') {
    socket = io(BACKEND_URL);
} else {
    socket = { on: () => { }, emit: () => { }, id: 'mock-id' };
}

// State
let activeView = 'analysis';
let currentTheme = localStorage.getItem('theme') || 'dark';
let sessionId = localStorage.getItem('session_id') || "";
let currentJobId = localStorage.getItem('current_job_id') || "";
let sessions = [];
let sessionHasImage = false;
let sessionReadyForChat = false;
let currentMetrics = null;
let isProcessing = false; // Global lock for any AI processing
let sessionImageUrl = '';
let selectedPreviewUrl = '';
let isSessionHydrating = true;
let currentTaskStatus = '';
let allowNextReplyToReplaceJob = false;
let sessionLoadToken = 0;
let galleryLoadToken = 0;

if (!sessionId) {
    sessionId = typeof crypto !== 'undefined' ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    localStorage.setItem('session_id', sessionId);
}

let analysisMessages = [];

let selectedFiles = [];

// DOM Elements
const analysisViewEl = document.getElementById('analysis-view');
const galleryViewEl = document.getElementById('gallery-view');
const analysisChatHistoryEl = document.getElementById('analysis-chat-history');
const analysisChatInputEl = document.getElementById('analysis-chat-input');
const analysisInputHintEl = document.getElementById('analysis-input-hint');
const analysisSendBtnEl = document.getElementById('analysis-send-btn');
const analysisFileInputEl = document.getElementById('analysis-file-input');
const analysisPreviewsEl = document.getElementById('analysis-previews');
const sessionUploadGateEl = document.getElementById('session-upload-gate');
const analysisSidePanelEl = document.getElementById('analysis-side-panel');
const appFooterEl = document.getElementById('app-footer');
const themeToggleEl = document.getElementById('theme-toggle');
const newSessionBtnEl = document.getElementById('new-session-btn');
const sessionListEl = document.getElementById('session-list');
const metricsPanelEl = document.getElementById('metrics-panel');
const galleryContentEl = document.getElementById('gallery-content');

function setCurrentJobId(jobId) {
    currentJobId = normalizeText(jobId).trim();
    if (currentJobId) {
        localStorage.setItem('current_job_id', currentJobId);
    } else {
        localStorage.removeItem('current_job_id');
    }
}

function applySessionTaskState(task) {
    sessionHasImage = hasTaskImage(task);
    sessionReadyForChat = sessionHasImage && hasTaskMask(task) && !isProcessingTaskStatus(task?.status);
    currentTaskStatus = normalizeText(task?.status).trim();

    setCurrentJobId(task?.job_id || task?.jobId || '');
    updateSessionImage(task?.image_url || task?.imageUrl || null);

    currentMetrics = task?.metrics || null;
    renderMetricsPanel(currentMetrics);
}

// ====================== SOCKET EVENTS ======================

socket.on('connect', () => {
    console.log('✅ Connected to WebSocket server:', socket.id);
    if (sessionId) {
        socket.emit('registerSession', { sessionId });
    }
});

socket.on('uploadStatus', (data) => {
    console.log('📡 uploadStatus:', data);
    const eventJobId = normalizeText(data?.details?.jobId).trim();
    if (!eventJobId || (!currentJobId && !isProcessing) || (currentJobId && eventJobId !== currentJobId)) {
        return;
    }

    const lastBotMsg = [...analysisMessages].reverse().find(m => m.sender === 'bot');

    if (data.status && data.status.includes('Segmentation complete')) {
        sessionHasImage = true;
        sessionReadyForChat = false;
        currentTaskStatus = 'processing_vlm';

        if (data.details?.metrics) {
            currentMetrics = data.details.metrics;
            renderMetricsPanel(currentMetrics);
        }
        if (data.details?.maskAllOverlay || data.details?.imageUrl) {
            updateSessionImage(data.details.imageUrl || sessionImageUrl);
        }
        if (lastBotMsg) lastBotMsg.text = '✅ Phân đoạn hoàn tất, đang tổng hợp nhận định...';
        lockChat();
        renderAnalysisMessages(true);
        return;
    }

    if (data.status && data.status.includes('Error')) {
        currentTaskStatus = 'error';
        sessionReadyForChat = false;
        if (lastBotMsg) lastBotMsg.text = `❌ Lỗi: ${data.details?.error || data.status}`;
        unlockChat();
        renderAnalysisMessages(true);
        return;
    }

    // Other status updates (queued, processing)
    if (lastBotMsg) {
        if (data.status === 'Processing segmentation' && data.details?.progress !== undefined) {
            lastBotMsg.progress = data.details.progress;
            lastBotMsg.estSecondsRemaining = data.details.estSecondsRemaining;

            // Cập nhật text để người dùng thấy rõ
            if (data.details.progress < 100) {
                lastBotMsg.text = `⏳ Đang phân tích dữ liệu... ${data.details.progress}%`;
            } else {
                lastBotMsg.text = `⏳ Đang tổng hợp kết quả...`;
            }
        } else {
            lastBotMsg.text = `⏳ ${data.status}...`;
            // Reset progress nếu status chuyển sang cái khác (như VLM)
            if (data.status !== 'Processing segmentation') {
                lastBotMsg.progress = undefined;
            }
        }
        renderAnalysisMessages();
    }
});

socket.on('receiveMessage', (data) => {
    console.log('💬 receiveMessage:', data);
    const incomingJobId = normalizeText(data?.jobId).trim();
    if (incomingJobId) {
        if (!currentJobId) {
            if (!isProcessing) {
                return;
            }
        } else if (incomingJobId !== currentJobId) {
            if (!(allowNextReplyToReplaceJob && isProcessing)) {
                return;
            }
        }
        setCurrentJobId(incomingJobId);
        allowNextReplyToReplaceJob = false;
    }

    const interimReply = isInterimReplyText(data?.reply);
    const thinkingIdx = findLastBotPlaceholderIndex();

    if (thinkingIdx !== -1) {
        analysisMessages[thinkingIdx].text = data.reply;
        analysisMessages[thinkingIdx].imageUrls = normalizeImageUrls(data.imageUrls || data.image_urls || []);
    } else {
        analysisMessages.push({
            id: Date.now().toString(),
            sender: 'bot',
            text: data.reply,
            createdAt: data.createdAt ? new Date(data.createdAt).getTime() : Date.now(),
            imageUrls: normalizeImageUrls(data.imageUrls || data.image_urls || [])
        });
    }

    if (interimReply) {
        currentTaskStatus = 'processing_vlm';
        lockChat();
        renderAnalysisMessages(true);
        fetchSessions();
        return;
    }

    currentTaskStatus = 'success_vlm';
    sessionReadyForChat = true;
    unlockChat();
    renderAnalysisMessages(true);
    fetchSessions();

    if (activeView === 'gallery') {
        renderGalleryForSession(sessionId);
    }
});
// ====================== RIGHT PANEL CONTROL ======================

function revokeObjectUrl(url) {
    if (url && typeof url === 'string' && url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
    }
}

function setSessionImageUrl(url) {
    const resolvedUrl = resolveImageUrl(url);
    if (sessionImageUrl && sessionImageUrl !== resolvedUrl) {
        revokeObjectUrl(sessionImageUrl);
    }
    sessionImageUrl = resolvedUrl || '';
}

function updateSessionImage(url) {
    const imgEl = document.getElementById('current-session-image');
    const placeholderEl = document.getElementById('session-image-placeholder');
    const resolvedUrl = resolveImageUrl(url);

    setSessionImageUrl(resolvedUrl);

    if (imgEl && resolvedUrl) {
        imgEl.src = resolvedUrl;
        imgEl.classList.remove('hidden');
        if (placeholderEl) placeholderEl.classList.add('hidden');
    } else if (imgEl) {
        imgEl.src = '';
        imgEl.classList.add('hidden');
        if (placeholderEl) placeholderEl.classList.remove('hidden');
    }

    renderSelectedPreviews();
    renderSessionUploadGate();
    syncComposerState();
}

// ====================== METRICS PANEL ======================

function renderMetricsPanel(metrics) {
    if (!metricsPanelEl) return;
    const emptyStateEl = document.getElementById('metrics-empty-state');
    const statusBadgeEl = document.getElementById('metric-status-badge');

    if (!metrics) {
        metricsPanelEl.classList.add('hidden');
        if (emptyStateEl) emptyStateEl.classList.remove('hidden');
        if (statusBadgeEl) statusBadgeEl.classList.add('hidden');
        return;
    }

    metricsPanelEl.classList.remove('hidden');
    if (emptyStateEl) emptyStateEl.classList.add('hidden');
    if (statusBadgeEl) statusBadgeEl.classList.remove('hidden');

    const statusEl = document.getElementById('metric-status');
    if (statusEl) {
        statusEl.innerHTML = Boolean(metrics.is_flooded)
            ? '<span class="inline-flex items-center gap-1.5 rounded-full bg-red-500/20 px-3 py-1 text-[10px] font-black text-red-400 uppercase tracking-widest"><i data-lucide="alert-triangle" class="h-3 w-3"></i> Khu vực Ngập</span>'
            : '<span class="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1 text-[10px] font-black text-emerald-400 uppercase tracking-widest"><i data-lucide="shield-check" class="h-3 w-3"></i> An toàn</span>';
    }

    const roadEl = document.getElementById('metric-road');
    const roadBarEl = document.getElementById('metric-road-bar');
    const roadFloodRatio = Math.min(toMetricNumber(metrics.road_flood_ratio), 100);
    if (roadEl) roadEl.textContent = `${roadFloodRatio}%`;
    if (roadBarEl) {
        setTimeout(() => { roadBarEl.style.width = `${roadFloodRatio}%`; }, 100);
    }

    const bldFloodEl = document.getElementById('metric-bld-flood');
    const bldTotalEl = document.getElementById('metric-bld-total');
    if (bldFloodEl) bldFloodEl.textContent = `${toMetricNumber(metrics.building_flooded_count)}`;
    if (bldTotalEl) bldTotalEl.textContent = `/ ${toMetricNumber(metrics.building_total_count)}`;

    const vehicleEl = document.getElementById('metric-vehicle');
    if (vehicleEl) vehicleEl.textContent = `${toMetricNumber(metrics.vehicle_on_flooded_road)}`;

    const coverageEl = document.getElementById('metric-coverage');
    if (coverageEl) coverageEl.textContent = `${toMetricNumber(metrics.flood_coverage_percent)}%`;

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ====================== CHAT LOCK/UNLOCK ======================

function renderSessionUploadGate() {
    if (!sessionUploadGateEl) return;

    const gateVisible = !sessionHasImage;
    const gatePreviewUrl = selectedPreviewUrl || (!sessionHasImage ? sessionImageUrl : '');

    sessionUploadGateEl.classList.toggle('hidden', !gateVisible);
    if (!gateVisible) {
        sessionUploadGateEl.innerHTML = '';
        return;
    }

    const hasPendingImage = Boolean(gatePreviewUrl);
    const selectedFile = selectedFiles[0];

    sessionUploadGateEl.disabled = isProcessing;
    sessionUploadGateEl.classList.toggle('is-ready', hasPendingImage);
    sessionUploadGateEl.classList.toggle('is-disabled', isProcessing);

    sessionUploadGateEl.innerHTML = `
        <div class="session-upload-gate__layout flex items-center gap-4 lg:gap-5">
            <div class="session-upload-gate__visual flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-[24px] lg:h-28 lg:w-28">
                ${hasPendingImage
                    ? `<img src="${escapeAttribute(gatePreviewUrl)}" alt="Selected session image" class="session-upload-gate__thumb h-full w-full object-cover" />`
                    : `<div class="flex flex-col items-center gap-2 text-brand-primary">
                            <i data-lucide="image-plus" class="h-8 w-8"></i>
                            <span class="text-[9px] font-black uppercase tracking-[0.25em]">1 ảnh</span>
                       </div>`}
            </div>
            <div class="min-w-0 flex-1">
                <div class="mb-2 flex flex-wrap items-center gap-2">
                    <span class="session-upload-gate__badge rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-brand-primary">
                        ${hasPendingImage ? 'Ảnh đã sẵn sàng' : 'Bắt buộc trước khi chat'}
                    </span>
                    <span class="text-[10px] font-bold uppercase tracking-[0.16em] text-ui-muted/60">
                        JPG • PNG • Paste trực tiếp
                    </span>
                </div>
                <h3 class="text-lg font-black tracking-tight text-ui-text">
                    ${hasPendingImage ? 'Nhấn gửi để chạy segment cho session này' : 'Bắt đầu session mới bằng một ảnh'}
                </h3>
                <p class="mt-1 text-sm leading-relaxed text-ui-muted">
                    ${hasPendingImage
                        ? 'Bạn có thể thêm một câu hỏi ngắn ở ô chat hoặc gửi ngay để FloodWiz segment ảnh.'
                        : 'Bấm để chọn ảnh, kéo thả file vào đây, hoặc dán ảnh bằng Ctrl+V để mở chat cho session này.'}
                </p>
                <p class="mt-3 truncate text-[11px] font-bold text-ui-muted/75">
                    ${escapeHtml(selectedFile?.name || 'Mẹo: sử dụng ảnh chụp từ UAV/drone để kết quả segment ổn định hơn.')}
                </p>
            </div>
            <div class="session-upload-gate__cta inline-flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-ui-text">
                <i data-lucide="${hasPendingImage ? 'refresh-cw' : 'mouse-pointer-click'}" class="h-4 w-4 text-brand-primary"></i>
                <span>${isProcessing ? 'Đang gửi ảnh...' : hasPendingImage ? 'Đổi ảnh' : 'Chọn ảnh'}</span>
            </div>
        </div>
    `;

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function syncComposerState() {
    const hasPendingImage = selectedFiles.length > 0;
    const inputLockedByGate = sessionReadyForChat ? false : (sessionHasImage || !hasPendingImage);
    const inputText = analysisChatInputEl?.value.trim() || '';
    const canSend = !isProcessing && (sessionReadyForChat ? inputText.length > 0 : (!sessionHasImage && hasPendingImage));

    if (analysisChatInputEl) {
        analysisChatInputEl.disabled = isProcessing || inputLockedByGate;
        analysisChatInputEl.placeholder = isProcessing
            ? "⏳ Đang xử lý, vui lòng chờ..."
            : sessionReadyForChat
                ? "Nhập câu hỏi về ảnh đã tải lên..."
                : sessionHasImage
                    ? (isProcessingTaskStatus(currentTaskStatus)
                        ? "Ảnh đang được AI xử lý, chưa thể hỏi tiếp..."
                        : "Session này chưa sẵn sàng để hỏi tiếp...")
                : hasPendingImage
                    ? "Thêm ghi chú cho lần segment này (tuỳ chọn)..."
                    : "Chọn ảnh ở ô lớn bên trên để bắt đầu...";
        analysisChatInputEl.classList.toggle('opacity-50', isProcessing || inputLockedByGate);
        analysisChatInputEl.classList.toggle('cursor-not-allowed', isProcessing || inputLockedByGate);
    }

    if (analysisInputHintEl) {
        analysisInputHintEl.textContent = isProcessing
            ? 'FloodWiz đang xử lý ảnh, composer sẽ mở lại ngay khi xong.'
            : sessionReadyForChat
                ? 'Ảnh của session đang được ghim bên cạnh để bạn hỏi tiếp.'
                : sessionHasImage
                    ? (isProcessingTaskStatus(currentTaskStatus)
                        ? 'Pipeline của session này vẫn đang chạy. Hãy đợi phản hồi cuối cùng.'
                        : 'Session hiện có ảnh nhưng chưa có kết quả hợp lệ để hỏi tiếp.')
                : hasPendingImage
                    ? 'Ảnh đã chọn. Bạn có thể gửi ngay hoặc thêm một câu hỏi ngắn.'
                    : 'Session mới cần một ảnh trước khi chat.';
    }

    if (analysisSendBtnEl) {
        analysisSendBtnEl.disabled = !canSend;
        analysisSendBtnEl.classList.toggle('opacity-40', !canSend);
        analysisSendBtnEl.classList.toggle('pointer-events-none', !canSend);
        analysisSendBtnEl.title = sessionReadyForChat
            ? 'Gửi câu hỏi'
            : (!sessionHasImage && hasPendingImage)
                ? 'Gửi ảnh để segment'
                : 'Hãy chọn ảnh trước';
    }

    renderSessionUploadGate();
}

function lockChat() {
    isProcessing = true;
    syncComposerState();
}

function unlockChat() {
    isProcessing = false;
    syncComposerState();
}

// ====================== SESSIONS ======================

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
        sessionListEl.innerHTML = '<div class="px-3 py-2 text-xs text-ui-muted/40 italic">Chưa có phiên nào</div>';
        return;
    }

    sessionListEl.innerHTML = sessions.map(s => {
        const isActive = s.sessionId === sessionId;
        const lastMsg = normalizeText(s.lastReply || s.lastQuestion || "Phiên đánh giá mới");
        const time = s.updatedAt ? formatRelativeTime(new Date(s.updatedAt).getTime()) : "";
        const safeSessionId = escapeAttribute(normalizeText(s.sessionId));

        return `
            <div onclick="loadSessionHistory('${safeSessionId}')" class="group relative flex flex-col gap-1 rounded-xl px-3 py-2.5 transition-all cursor-pointer ${isActive ? 'bg-brand-primary/10 border-l-2 border-brand-primary' : 'hover:bg-white/5'}">
                <div class="flex items-center justify-between">
                    <span class="text-[11px] font-bold tracking-tight ${isActive ? 'text-brand-primary' : 'text-ui-text'} truncate w-32">
                        ${escapeHtml(normalizeText(s.sessionId).substring(0, 8))}...
                    </span>
                    <span class="text-[9px] font-medium text-ui-muted opacity-60">${time}</span>
                </div>
                <p class="text-[10px] leading-tight text-ui-muted truncate opacity-80 group-hover:opacity-100">
                    ${escapeHtml(lastMsg.length > 50 ? lastMsg.substring(0, 50) + '...' : lastMsg)}
                </p>
            </div>
        `;
    }).join('');
}

async function loadSessionHistory(id) {
    if (!id) return;
    const loadToken = ++sessionLoadToken;

    sessionId = id;
    localStorage.setItem('session_id', id);
    socket.emit('registerSession', { sessionId });

    // Reset state
    sessionHasImage = false;
    sessionReadyForChat = false;
    currentMetrics = null;
    isProcessing = false;
    isSessionHydrating = true;
    currentTaskStatus = '';
    allowNextReplyToReplaceJob = false;
    setCurrentJobId('');
    clearSelectedFiles();
    updateSessionImage(null);
    if (metricsPanelEl) metricsPanelEl.classList.add('hidden');

    // Reset messages to default welcome
    analysisMessages = [{
        id: "1", sender: "bot",
        text: "Đang tải lịch sử phiên...",
        createdAt: Date.now(), imageUrls: []
    }];
    renderAnalysisMessages();
    renderSessionList();

    try {
        // Load session history
        const res = await fetch(`${BACKEND_URL}/chat/sessions/${id}`);
        if (res.ok) {
            const data = await res.json();
            if (loadToken !== sessionLoadToken || sessionId !== id) return;
            const dbSession = data.session;
            if (dbSession && dbSession.history && dbSession.history.length > 0) {
                analysisMessages = dbSession.history.map((h, i) => {
                    return {
                        id: i.toString(),
                        sender: (h.role === 'user' || h.sender === 'user') ? 'user' : 'bot',
                        text: h.content || h.text || '',
                        createdAt: h.createdAt ? new Date(h.createdAt).getTime() : Date.now(),
                        imageUrls: normalizeImageUrls(h.imageUrls || h.image_urls || [])
                    };
                }).filter((msg) => !(msg.sender === 'user' && !msg.text.trim() && msg.imageUrls.length === 0));
            } else {
                analysisMessages = [];
            }
            renderAnalysisMessages(true);
        }

        // Load tasks for this session to get metrics & session image
        const taskRes = await fetch(`${BACKEND_URL}/chat/tasks/${id}`);
        if (loadToken !== sessionLoadToken || sessionId !== id) return;
        if (taskRes.ok) {
            const taskData = await taskRes.json();
            const tasks = taskData.tasks || [];
            if (tasks.length > 0) {
                const latestTask = tasks[0];
                applySessionTaskState(latestTask);

                isSessionHydrating = false;
                if (isProcessingTaskStatus(latestTask.status)) {
                    lockChat();
                } else {
                    unlockChat();
                }
                renderAnalysisMessages(true);
            } else {
                sessionHasImage = false;
                sessionReadyForChat = false;
                currentTaskStatus = '';
                setCurrentJobId('');
                updateSessionImage(null);
                renderMetricsPanel(null);
                isSessionHydrating = false;
                unlockChat();
                renderAnalysisMessages(true);
            }
        } else {
            sessionHasImage = false;
            sessionReadyForChat = false;
            currentTaskStatus = '';
            setCurrentJobId('');
            updateSessionImage(null);
            renderMetricsPanel(null);
            isSessionHydrating = false;
            unlockChat();
            renderAnalysisMessages(true);
        }

        if (activeView === 'gallery') renderGalleryForSession(id);
    } catch (err) {
        console.error('Failed to load history:', err);
        analysisMessages = [];
        isSessionHydrating = false;
        unlockChat();
        renderAnalysisMessages(true);
    }
}

function formatRelativeTime(createdAt) {
    const diffMs = Math.max(0, Date.now() - createdAt);
    const diffMinutes = Math.floor(diffMs / 60000);
    if (diffMinutes === 0) return 'Vừa xong';
    if (diffMinutes < 60) return `${diffMinutes} ph`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} giờ`;
    return new Date(createdAt).toLocaleDateString('vi-VN');
}

// ====================== VIEW SWITCHING ======================

function switchView(view) {
    activeView = view;

    document.querySelectorAll('.nav-link').forEach(item => {
        const text = item.textContent.trim().toLowerCase();
        if ((view === 'analysis' && text === 'assessment') || (view === 'gallery' && text === 'mask gallery')) {
            item.classList.add('text-brand-primary');
            item.classList.remove('text-ui-muted');
        } else {
            item.classList.remove('text-brand-primary');
            item.classList.add('text-ui-muted');
        }
    });

    if (view === 'analysis') {
        document.body.classList.add('analysis-scroll-lock');
        appFooterEl?.classList.add('hidden');
        analysisViewEl.classList.remove('hidden');
        analysisViewEl.classList.add('flex');
        galleryViewEl.classList.add('hidden');
        galleryViewEl.classList.remove('flex');
        renderAnalysisMessages(true);
    } else {
        document.body.classList.remove('analysis-scroll-lock');
        appFooterEl?.classList.remove('hidden');
        analysisViewEl.classList.add('hidden');
        analysisViewEl.classList.remove('flex');
        galleryViewEl.classList.remove('hidden');
        galleryViewEl.classList.add('flex');
        renderGalleryForSession(sessionId);
    }
}

// ====================== GALLERY WITH SLIDER ======================

async function renderGalleryForSession(sid) {
    if (!galleryContentEl) return;
    const loadToken = ++galleryLoadToken;

    galleryContentEl.innerHTML = '<div class="text-center text-ui-muted py-20 animate-pulse">Đang tải dữ liệu gallery...</div>';

    try {
        const res = await fetch(`${BACKEND_URL}/chat/tasks/${sid}`);
        if (!res.ok) throw new Error('Failed to fetch tasks');
        const data = await res.json();
        if (loadToken !== galleryLoadToken || sid !== sessionId) return;
        // Hỗ trợ cả snake_case và camelCase từ database
        const tasks = (data.tasks || []).filter(t => (t.mask_all_overlay || t.maskAllOverlay) && (t.image_url || t.imageUrl));

        if (tasks.length === 0) {
            galleryContentEl.innerHTML = `
                <div class="flex flex-col items-center justify-center py-20 glass-panel rounded-2xl">
                    <i data-lucide="image-off" class="h-12 w-12 text-ui-muted/30 mb-4"></i>
                    <p class="text-sm font-semibold text-ui-text mb-2">Chưa có mask nào cho phiên này</p>
                    <p class="text-[10px] uppercase tracking-widest text-ui-muted">Tải ảnh lên trong trang Assessment để tạo mask</p>
                </div>`;
            if (typeof lucide !== 'undefined') lucide.createIcons();
            return;
        }

        galleryContentEl.innerHTML = tasks.map((task, idx) => {
            const metricsHtml = task.metrics ? buildMetricsBadgesHtml(task.metrics) : '';
            const originalImageUrl = escapeAttribute(resolveImageUrl(task.image_url || task.imageUrl));
            const maskImageUrl = escapeAttribute(resolveImageUrl(task.mask_all_overlay || task.maskAllOverlay));
            return `
                <div class="glass-card rounded-2xl overflow-hidden animate-slide-up" style="animation-delay: ${idx * 100}ms">
                    <!-- Legend -->
                    <div class="p-3 bg-black/20 text-[10px] sm:text-xs flex flex-wrap gap-2 justify-center border-b border-white/5">
                        <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-sm" style="background: rgb(220, 20, 60)"></span> Nhà ngập</span>
                        <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-sm" style="background: rgb(197, 235, 19)"></span> Nhà</span>
                        <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-sm" style="background: rgb(128, 64, 128)"></span> Đường ngập</span>
                        <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-sm" style="background: rgb(105, 105, 105)"></span> Đường</span>
                        <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-sm" style="background: rgb(0, 191, 255)"></span> Nước</span>
                        <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-sm" style="background: rgb(34, 139, 34)"></span> Cây cỏ</span>
                        <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-sm" style="background: rgb(255, 165, 0)"></span> Phương tiện</span>
                        <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-sm" style="background: rgb(0, 128, 128)"></span> Hồ bơi</span>
                        <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-sm" style="background: rgb(124, 252, 0)"></span> Cỏ</span>
                    </div>
                    <!-- Comparison Slider -->
                    <div class="comparison-slider" data-idx="${idx}">
                        <div class="comparison-container relative overflow-hidden" style="aspect-ratio: 16/10">
                            <!-- Base layer (Original Image) -->
                            <img class="comparison-img-bottom absolute inset-0 w-full h-full object-cover" src="${originalImageUrl}" alt="Original" />
                            
                            <!-- Overlay layer (Mask - Always Pure now, overlaid with 70% opacity by CSS) -->
                            <img class="comparison-img-top absolute inset-0 w-full h-full object-cover" src="${maskImageUrl}" alt="Mask overlay" style="clip-path: inset(0 50% 0 0); opacity: 0.7;" />
                            <div class="comparison-handle absolute top-0 bottom-0 flex items-center justify-center cursor-ew-resize z-10" style="left: 50%; transform: translateX(-50%)">
                                <div class="w-1 h-full bg-white/80 shadow-xl"></div>
                                <div class="absolute w-10 h-10 rounded-full bg-white/20 backdrop-blur-md border-2 border-white/60 flex items-center justify-center shadow-2xl">
                                    <i data-lucide="move-horizontal" class="h-4 w-4 text-white"></i>
                                </div>
                            </div>
                            <div class="absolute top-4 left-4 z-20">
                                <span class="rounded-full bg-black/50 backdrop-blur-md px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-white flex items-center gap-1.5">
                                    <i data-lucide="image" class="h-3 w-3"></i> Ảnh gốc
                                </span>
                            </div>
                            <div class="absolute top-4 right-4 z-20">
                                <span class="rounded-full bg-brand-primary/80 backdrop-blur-md px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-white flex items-center gap-1.5">
                                    <i data-lucide="layers" class="h-3 w-3"></i> Mask AI
                                </span>
                            </div>
                        </div>
                    </div>
                    <!-- Metrics row -->
                    ${metricsHtml ? `<div class="p-5 border-t border-white/5">${metricsHtml}</div>` : ''}
                </div>
            `;
        }).join('');

        requestAnimationFrame(() => {
            initComparisonSliders();
            if (typeof lucide !== 'undefined') lucide.createIcons();
        });
    } catch (err) {
        console.error('Gallery fetch error:', err);
        galleryContentEl.innerHTML = '<div class="text-center text-red-400 py-20">Không thể tải gallery</div>';
    }
}

function buildMetricsBadgesHtml(metrics) {
    const roadFloodRatio = toMetricNumber(metrics.road_flood_ratio);
    const buildingFloodedCount = toMetricNumber(metrics.building_flooded_count);
    const buildingTotalCount = toMetricNumber(metrics.building_total_count);
    const vehicleOnFloodedRoad = toMetricNumber(metrics.vehicle_on_flooded_road);
    const floodCoveragePercent = toMetricNumber(metrics.flood_coverage_percent);
    const statusBadge = Boolean(metrics.is_flooded)
        ? '<span class="rounded-full bg-red-500/20 px-2.5 py-1 text-[9px] font-black text-red-400 uppercase flex items-center gap-1"><i data-lucide="alert-triangle" class="h-3 w-3"></i> Ngập</span>'
        : '<span class="rounded-full bg-emerald-500/20 px-2.5 py-1 text-[9px] font-black text-emerald-400 uppercase flex items-center gap-1"><i data-lucide="shield-check" class="h-3 w-3"></i> An toàn</span>';

    return `
        <div class="flex flex-wrap items-center gap-3">
            ${statusBadge}
            <span class="text-[10px] font-bold text-ui-muted flex items-center gap-1"><i data-lucide="road" class="h-3 w-3 text-brand-primary"></i> Đường ngập: <strong class="text-brand-primary">${roadFloodRatio}%</strong></span>
            <span class="text-[10px] font-bold text-ui-muted flex items-center gap-1"><i data-lucide="building" class="h-3 w-3 text-red-400"></i> Nhà ngập: <strong class="text-red-400">${buildingFloodedCount}</strong>/${buildingTotalCount}</span>
            <span class="text-[10px] font-bold text-ui-muted flex items-center gap-1"><i data-lucide="car" class="h-3 w-3 text-orange-400"></i> Xe: <strong class="text-orange-400">${vehicleOnFloodedRoad}</strong></span>
            <span class="text-[10px] font-bold text-ui-muted flex items-center gap-1"><i data-lucide="droplets" class="h-3 w-3 text-brand-primary"></i> Phủ ngập: <strong class="text-brand-primary">${floodCoveragePercent}%</strong></span>
        </div>
    `;
}

function initComparisonSliders() {
    document.querySelectorAll('.comparison-slider').forEach(slider => {
        const container = slider.querySelector('.comparison-container');
        const handle = slider.querySelector('.comparison-handle');
        const topImg = slider.querySelector('.comparison-img-top');
        if (!container || !handle || !topImg) return;

        let isDragging = false;

        function updateSlider(clientX) {
            const rect = container.getBoundingClientRect();
            let x = clientX - rect.left;
            x = Math.max(0, Math.min(x, rect.width));
            const percent = (x / rect.width) * 100;

            // Xử lý clip layer trên (mask)
            const topImg = container.querySelector('.comparison-img-top');
            if (topImg) {
                // Hiển thị phần bên TRÁI của ảnh mask, nội dung từ 0 -> percent%
                // clip-path: inset(0 100-percent% 0 0) - cắt phần bên PHẢI đi
                topImg.style.clipPath = `inset(0 ${100 - percent}% 0 0)`;
            }

            handle.style.left = `${percent}%`;
        }

        handle.addEventListener('mousedown', (e) => { isDragging = true; e.preventDefault(); });
        container.addEventListener('mousedown', (e) => { isDragging = true; updateSlider(e.clientX); });
        window.addEventListener('mouseup', () => { isDragging = false; });
        window.addEventListener('mousemove', (e) => { if (isDragging) updateSlider(e.clientX); });

        handle.addEventListener('touchstart', (e) => { isDragging = true; e.preventDefault(); });
        container.addEventListener('touchstart', (e) => { isDragging = true; updateSlider(e.touches[0].clientX); });
        window.addEventListener('touchend', () => { isDragging = false; });
        window.addEventListener('touchmove', (e) => { if (isDragging) updateSlider(e.touches[0].clientX); });
        // Khởi tạo vị trí 50% ban đầu
        const rect = container.getBoundingClientRect();
        if (rect.width > 0) {
            updateSlider(rect.left + rect.width / 2);
        } else {
            // Fallback nếu chưa render xong
            setTimeout(() => {
                const r = container.getBoundingClientRect();
                updateSlider(r.left + r.width / 2);
            }, 100);
        }
    });
}

// ====================== CHAT RENDERING ======================

function toggleTheme() {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    applyTheme();
}

function applyTheme() {
    document.documentElement.setAttribute('data-theme', currentTheme);
    localStorage.setItem('theme', currentTheme);

    if (themeToggleEl) {
        themeToggleEl.innerHTML = currentTheme === 'light'
            ? '<i data-lucide="moon" class="h-5 w-5"></i>'
            : '<i data-lucide="sun" class="h-5 w-5"></i>';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
}

function createNewSession() {
    sessionId = typeof crypto !== 'undefined' ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    localStorage.setItem('session_id', sessionId);
    setCurrentJobId('');
    socket.emit('registerSession', { sessionId });
    sessionHasImage = false;
    sessionReadyForChat = false;
    currentMetrics = null;
    isProcessing = false;
    isSessionHydrating = false;
    currentTaskStatus = '';
    allowNextReplyToReplaceJob = false;

    if (metricsPanelEl) metricsPanelEl.classList.add('hidden');
    updateSessionImage(null);
    renderMetricsPanel(null);

    analysisMessages = [];
    clearSelectedFiles();
    unlockChat();
    renderAnalysisMessages(true);
    fetchSessions();
}

function shouldRenderWelcomeState() {
    return !isSessionHydrating && !sessionHasImage && selectedFiles.length === 0 && analysisMessages.length === 0;
}

function shouldDimAnalysisPanels() {
    return !isSessionHydrating && !sessionHasImage && selectedFiles.length === 0;
}

function syncAnalysisShellState() {
    if (analysisSidePanelEl) {
        analysisSidePanelEl.classList.toggle('analysis-side-panel--dimmed', shouldDimAnalysisPanels());
    }
}

function buildWelcomeStateMarkup() {
    return `
        <div class="analysis-empty-state">
            <div class="analysis-empty-state__panel">
                <div class="analysis-empty-state__logo">
                    <i data-lucide="waves"></i>
                </div>
                <p class="text-[10px] font-black uppercase tracking-[0.28em] text-brand-primary/80">Flood Analysis</p>
                <h2 class="mt-3 text-4xl font-black tracking-tight text-ui-text">FloodWiz</h2>
                <p class="mt-4 text-sm leading-relaxed text-ui-muted">
                    Chọn một ảnh UAV/drone trong khung upload bên dưới để bắt đầu segment cho session này.
                </p>
                <button type="button" data-open-upload="welcome" class="analysis-empty-state__upload">
                    <span class="analysis-empty-state__upload-icon">
                        <i data-lucide="image-plus"></i>
                    </span>
                    <span class="min-w-0 flex-1">
                        <span class="block text-sm font-black tracking-tight text-ui-text">Tải ảnh để bắt đầu</span>
                        <span class="mt-1 block text-[11px] font-bold text-ui-muted/80">Click để chọn ảnh, hoặc kéo thả / Ctrl+V ngay tại đây.</span>
                    </span>
                    <span class="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-brand-primary">
                        Chọn ảnh
                    </span>
                </button>
            </div>
        </div>
    `;
}

function renderAnalysisMessages(scrollToBottom = false) {
    if (!analysisChatHistoryEl) return;
    syncAnalysisShellState();

    if (shouldRenderWelcomeState()) {
        analysisChatHistoryEl.classList.add('analysis-chat-history--welcome');
        analysisChatHistoryEl.innerHTML = buildWelcomeStateMarkup();
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    analysisChatHistoryEl.classList.remove('analysis-chat-history--welcome');
    analysisChatHistoryEl.innerHTML = analysisMessages.map(msg => {
        const safeText = normalizeText(msg.text).trim();
        const hasText = safeText.length > 0;
        const imageUrls = normalizeImageUrls(msg.imageUrls);
        const hasImages = imageUrls.length > 0;
        const isBot = msg.sender === "bot" || msg.sender === "assistant";
        const authorLabel = isBot ? "Neural Engine" : "Người dùng";

        if (!hasText && !hasImages && !(isBot && msg.progress !== undefined)) {
            return '';
        }

        const imageHtml = hasImages
            ? `<div class="mb-3 flex flex-wrap gap-3 ${msg.sender === "user" ? "justify-end" : ""}">
                    ${imageUrls.map((url, idx) => `
                        <div class="overflow-hidden rounded-2xl border border-white/10 bg-black/20 shadow-lg">
                            <img src="${escapeAttribute(url)}" alt="Chat attachment ${idx + 1}" class="block h-40 w-40 object-cover sm:h-48 sm:w-48" loading="lazy" />
                        </div>
                    `).join('')}
               </div>`
            : '';

        const textHtml = hasText
            ? `<div class="rounded-2xl p-5 shadow-sm ${isBot ? "rounded-bl-none glass-panel" : "chat-bubble-user"}">
                    <p class="text-sm font-medium leading-relaxed whitespace-pre-wrap">${escapeHtml(safeText).replace(/\n/g, '<br>')}</p>
               </div>`
            : '';

        const progressHtml = (() => {
            if (!(isBot && msg.progress !== undefined)) {
                return '';
            }

            const progressValue = Math.min(Math.max(toMetricNumber(msg.progress), 0), 100);
            const estSecondsRemaining = Math.max(toMetricNumber(msg.estSecondsRemaining), 0);
            return `<div class="mt-3 w-full min-w-[200px]">
                    <div class="flex items-center justify-between mb-1.5">
                        <span class="text-[9px] font-black uppercase tracking-widest text-brand-primary flex items-center gap-1">
                            <span class="relative flex h-2 w-2">
                              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-primary opacity-75"></span>
                              <span class="relative inline-flex rounded-full h-2 w-2 bg-brand-primary"></span>
                            </span>
                            Neural Progress
                        </span>
                        <span class="text-[10px] font-black text-brand-primary">${progressValue}%</span>
                    </div>
                    <div class="h-2 w-full bg-white/5 rounded-full overflow-hidden border border-white/5 p-[1px]">
                        <div class="h-full bg-gradient-to-r from-brand-primary/40 to-brand-primary rounded-full transition-all duration-700 cubic-bezier(0.4, 0, 0.2, 1)" style="width: ${progressValue}%"></div>
                    </div>
                    ${estSecondsRemaining > 0 ? `<p class="mt-1.5 text-[9px] font-bold text-ui-muted opacity-50 uppercase tracking-widest text-right animate-pulse">Còn khoảng ${estSecondsRemaining}s...</p>` : ''}
               </div>`;
        })();

        const iconName = isBot ? "bot" : "user";

        return `
            <div class="flex gap-5 ${msg.sender === "user" ? "flex-row-reverse" : ""} animate-slide-up">
                <div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${isBot ? "bg-brand-primary/10 text-brand-primary" : "bg-white/5 text-ui-muted"}">
                    <i data-lucide="${iconName}" class="w-5 h-5"></i>
                </div>
                <div class="max-w-[80%]">
                    ${imageHtml}
                    ${textHtml}
                    ${progressHtml}
                    <p class="mt-2 px-1 text-[10px] font-bold uppercase tracking-[0.15em] text-ui-muted/50 ${msg.sender === "user" ? "text-right" : ""}">
                        ${authorLabel} • ${formatRelativeTime(msg.createdAt || Date.now())}
                    </p>
                </div>
            </div>
        `;
    }).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();

    if (scrollToBottom) {
        analysisChatHistoryEl.scrollTop = analysisChatHistoryEl.scrollHeight;
    }
}

// ====================== FILE HANDLING ======================

function isImageFile(file) {
    return Boolean(file && typeof file.type === 'string' && file.type.startsWith('image/'));
}

function clearSelectedFiles(options = {}) {
    const { preservePreview = false } = options;
    selectedFiles = [];
    if (!preservePreview && selectedPreviewUrl) {
        revokeObjectUrl(selectedPreviewUrl);
        selectedPreviewUrl = '';
    }
    if (analysisFileInputEl) analysisFileInputEl.value = '';
    renderSelectedPreviews();
    syncComposerState();
    syncAnalysisShellState();
    renderAnalysisMessages();
}

function setSelectedFile(file) {
    if (!isImageFile(file)) return;

    clearSelectedFiles();
    selectedFiles = [file];
    selectedPreviewUrl = URL.createObjectURL(file);
    renderSelectedPreviews();
    syncComposerState();
    syncAnalysisShellState();
    renderAnalysisMessages();
}

function promoteSelectedPreviewToSessionImage() {
    if (!selectedPreviewUrl) return;

    setSessionImageUrl(selectedPreviewUrl);
    selectedPreviewUrl = '';
    renderSelectedPreviews();
    syncComposerState();
}

function renderSelectedPreviews() {
    if (!analysisPreviewsEl) return;
    const previewUrl = selectedPreviewUrl;
    const selectedFile = selectedFiles[0];

    if (!previewUrl) {
        analysisPreviewsEl.innerHTML = '';
        analysisPreviewsEl.classList.add('hidden');
        return;
    }

    analysisPreviewsEl.classList.remove('hidden');
    analysisPreviewsEl.innerHTML = `
        <div class="session-inline-media flex items-center gap-3 rounded-[22px] px-3 py-2.5">
            <img src="${escapeAttribute(previewUrl)}" alt="Session preview" class="h-14 w-14 shrink-0 rounded-2xl object-cover" />
            <div class="min-w-0">
                <p class="truncate text-xs font-bold text-ui-text">
                    ${escapeHtml(selectedFile?.name || 'Sẵn sàng để gửi')}
                </p>
                <p class="text-[10px] text-ui-muted/70">
                    Bạn có thể đổi ảnh trước khi gửi.
                </p>
            </div>
            <button type="button" data-clear-selected-image="true" class="preview-remove-btn ml-auto flex h-8 w-8 items-center justify-center rounded-full text-xs font-black text-white" aria-label="Xóa ảnh đã chọn">×</button>
        </div>
    `;
}

function handleGlobalPaste(event) {
    if (activeView !== 'analysis' || sessionHasImage || isProcessing) return;

    const target = event.target;
    const isEditable = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target && target.isContentEditable);
    if (isEditable && target !== analysisChatInputEl) return;

    const clipboardItems = Array.from(event.clipboardData?.items || []);
    const pastedImages = clipboardItems.filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(isImageFile);
    if (pastedImages.length === 0) return;

    event.preventDefault();
    setSelectedFile(pastedImages[0]);
}

// ====================== SEND MESSAGE ======================

async function handleSendMessage() {
    if (isProcessing) return;

    const text = analysisChatInputEl.value.trim();
    const filesToSend = [...selectedFiles];

    // Nothing to send
    if (filesToSend.length === 0 && !text) return;

    // Text-only not allowed until image is uploaded
    if (!sessionHasImage && filesToSend.length === 0) return;

    analysisChatInputEl.value = '';
    syncComposerState();

    if (text || filesToSend.length > 0) {
        analysisMessages.push({
            id: Date.now().toString(),
            sender: 'user',
            text,
            createdAt: Date.now(),
            imageUrls: filesToSend.length > 0 && selectedPreviewUrl ? [selectedPreviewUrl] : []
        });
    }

    // Add thinking message
    analysisMessages.push({
        id: (Date.now() + 1).toString(),
        sender: 'bot',
        text: filesToSend.length > 0 ? "⏳ Đang xử lý phân đoạn..." : "Đang suy nghĩ...",
        createdAt: Date.now(),
        imageUrls: []
    });
    renderAnalysisMessages(true);
    lockChat();

    if (filesToSend.length > 0) {
        // Image upload flow
        sessionHasImage = true;
        sessionReadyForChat = false;
        currentTaskStatus = 'queued';
        syncComposerState();

        try {
            const file = filesToSend[0];
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
                    setCurrentJobId(uploadData.jobId);
                }
                if (uploadData.sessionId) {
                    sessionId = uploadData.sessionId;
                    localStorage.setItem('session_id', sessionId);
                    socket.emit('registerSession', { sessionId });
                }
                promoteSelectedPreviewToSessionImage();
                clearSelectedFiles({ preservePreview: true });
            } else {
                const errData = await uploadRes.json().catch(() => ({}));
                const lastBot = [...analysisMessages].reverse().find(m => m.sender === 'bot');
                if (lastBot) lastBot.text = `❌ Lỗi upload: ${errData.message || uploadRes.statusText}`;
                sessionHasImage = false;
                sessionReadyForChat = false;
                currentTaskStatus = 'error';
                setCurrentJobId('');
                unlockChat();
                renderAnalysisMessages(true);
            }
            fetchSessions();
        } catch (error) {
            console.error('Pipeline error:', error);
            const lastBot = [...analysisMessages].reverse().find(m => m.sender === 'bot');
            if (lastBot) lastBot.text = `❌ Lỗi kết nối: ${error.message}`;
            sessionHasImage = false;
            sessionReadyForChat = false;
            currentTaskStatus = 'error';
            setCurrentJobId('');
            unlockChat();
            renderAnalysisMessages(true);
        }
    } else {
        // Text-only follow-up (chat with VLM)
        allowNextReplyToReplaceJob = true;
        socket.emit('sendMessage', {
            message: text,
            jobId: currentJobId || undefined,
            sessionId: sessionId
        });
    }
}

// ====================== EVENT LISTENERS ======================

analysisSendBtnEl?.addEventListener('click', handleSendMessage);
analysisChatInputEl?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        handleSendMessage();
    }
});
analysisFileInputEl?.addEventListener('change', (e) => {
    if (sessionHasImage || isProcessing) return;
    const files = Array.from(e.target.files || []).filter(isImageFile);
    if (files.length > 0) {
        setSelectedFile(files[0]);
    }
    analysisFileInputEl.value = '';
});
analysisPreviewsEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-clear-selected-image]');
    if (!btn) return;
    clearSelectedFiles();
});

analysisChatHistoryEl?.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-open-upload]');
    if (!trigger || sessionHasImage || isProcessing) return;
    analysisFileInputEl?.click();
});

['dragenter', 'dragover'].forEach(eventName => {
    analysisChatHistoryEl?.addEventListener(eventName, (event) => {
        if (!shouldRenderWelcomeState()) return;
        event.preventDefault();
        const uploadBox = analysisChatHistoryEl.querySelector('.analysis-empty-state__upload');
        uploadBox?.classList.add('is-dragover');
    });
});

['dragleave', 'dragend', 'drop'].forEach(eventName => {
    analysisChatHistoryEl?.addEventListener(eventName, (event) => {
        const uploadBox = analysisChatHistoryEl.querySelector('.analysis-empty-state__upload');
        if (eventName !== 'dragleave' || event.currentTarget === event.target) {
            uploadBox?.classList.remove('is-dragover');
        }
        if (eventName === 'drop') {
            if (!shouldRenderWelcomeState()) return;
            event.preventDefault();
            const files = Array.from(event.dataTransfer?.files || []).filter(isImageFile);
            if (files.length > 0) setSelectedFile(files[0]);
        }
    });
});

document.addEventListener('paste', handleGlobalPaste);

analysisChatInputEl?.addEventListener('input', syncComposerState);
sessionUploadGateEl?.addEventListener('click', () => {
    if (!sessionHasImage && !isProcessing) analysisFileInputEl?.click();
});

['dragenter', 'dragover'].forEach(eventName => {
    sessionUploadGateEl?.addEventListener(eventName, (event) => {
        if (sessionHasImage || isProcessing) return;
        event.preventDefault();
        sessionUploadGateEl.classList.add('is-dragover');
    });
});

['dragleave', 'dragend', 'drop'].forEach(eventName => {
    sessionUploadGateEl?.addEventListener(eventName, (event) => {
        if (!sessionUploadGateEl) return;
        if (eventName !== 'dragleave' || event.currentTarget === event.target) {
            sessionUploadGateEl.classList.remove('is-dragover');
        }
        if (eventName === 'drop') {
            event.preventDefault();
            if (sessionHasImage || isProcessing) return;
            const files = Array.from(event.dataTransfer?.files || []).filter(isImageFile);
            if (files.length > 0) setSelectedFile(files[0]);
        }
    });
});

themeToggleEl?.addEventListener('click', toggleTheme);
newSessionBtnEl?.addEventListener('click', createNewSession);

// ====================== INITIALIZATION ======================

document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    switchView('analysis');
    renderSelectedPreviews();
    syncComposerState();

    if (typeof lucide !== 'undefined') lucide.createIcons();

    if (sessionId) {
        loadSessionHistory(sessionId);
    }
    fetchSessions();
});

// Global Scope
window.switchView = switchView;
window.loadSessionHistory = loadSessionHistory;
