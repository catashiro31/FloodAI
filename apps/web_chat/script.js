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
let currentMetrics = null;
let isProcessing = false; // Global lock for any AI processing

if (!sessionId) {
    sessionId = typeof crypto !== 'undefined' ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    localStorage.setItem('session_id', sessionId);
}

let analysisMessages = [
    {
        id: "1",
        sender: "bot",
        text: "Chào mừng bạn đến FloodWiz! Hãy tải lên ảnh UAV/drone để bắt đầu phân tích ngập lụt. Mỗi phiên chỉ cho phép 1 ảnh.",
        createdAt: Date.now(),
        imageUrls: []
    }
];

let selectedFiles = [];

// DOM Elements
const analysisViewEl = document.getElementById('analysis-view');
const galleryViewEl = document.getElementById('gallery-view');
const analysisChatHistoryEl = document.getElementById('analysis-chat-history');
const analysisChatInputEl = document.getElementById('analysis-chat-input');
const analysisSendBtnEl = document.getElementById('analysis-send-btn');
const analysisUploadTriggerEl = document.getElementById('analysis-upload-trigger');
const analysisFileInputEl = document.getElementById('analysis-file-input');
const analysisPreviewsEl = document.getElementById('analysis-previews');
const themeToggleEl = document.getElementById('theme-toggle');
const newSessionBtnEl = document.getElementById('new-session-btn');
const sessionListEl = document.getElementById('session-list');
const metricsPanelEl = document.getElementById('metrics-panel');
const galleryContentEl = document.getElementById('gallery-content');

// ====================== SOCKET EVENTS ======================

socket.on('connect', () => {
    console.log('✅ Connected to WebSocket server:', socket.id);
    if (sessionId) {
        socket.emit('registerSession', { sessionId });
    }
});

socket.on('uploadStatus', (data) => {
    console.log('📡 uploadStatus:', data);
    const lastBotMsg = [...analysisMessages].reverse().find(m => m.sender === 'bot');

    if (data.status && data.status.includes('Segmentation complete')) {
        // Segmentation done — show metrics, unlock chat
        if (data.details?.metrics) {
            currentMetrics = data.details.metrics;
            renderMetricsPanel(currentMetrics);
        }
        if (data.details?.imageUrl) {
            updateSessionImage(data.details.imageUrl);
        }
        if (lastBotMsg) lastBotMsg.text = '✅ Phân đoạn hoàn tất! Mời bạn đặt câu hỏi về ảnh.';
        unlockChat();
        renderAnalysisMessages(true);
        return;
    }

    if (data.status && data.status.includes('Error')) {
        isProcessing = false;
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
    if (data.jobId) {
        currentJobId = data.jobId;
        localStorage.setItem('current_job_id', currentJobId);
    }

    // Find the "Thinking..." or pipeline message to replace
    const thinkingIdx = analysisMessages.findIndex(m =>
        m.sender === 'bot' && (m.text === 'Đang suy nghĩ...' || m.text.includes('⏳') || m.text.includes('Pipeline'))
    );

    if (thinkingIdx !== -1) {
        analysisMessages[thinkingIdx].text = data.reply;
        analysisMessages[thinkingIdx].imageUrls = (data.imageUrls || []).map(resolveImageUrl);
    } else {
        analysisMessages.push({
            id: Date.now().toString(),
            sender: 'bot',
            text: data.reply,
            createdAt: data.createdAt ? new Date(data.createdAt).getTime() : Date.now(),
            imageUrls: (data.imageUrls || []).map(resolveImageUrl)
        });
    }

    isProcessing = false;
    unlockChat();
    renderAnalysisMessages(true);
    fetchSessions();

    if (activeView === 'gallery') {
        renderGalleryForSession(sessionId);
    }
});
// ====================== RIGHT PANEL CONTROL ======================

function updateSessionImage(url) {
    const imgEl = document.getElementById('current-session-image');
    const placeholderEl = document.getElementById('session-image-placeholder');

    if (imgEl && url) {
        imgEl.src = resolveImageUrl(url);
        imgEl.classList.remove('hidden');
        if (placeholderEl) placeholderEl.classList.add('hidden');
    } else if (imgEl) {
        imgEl.classList.add('hidden');
        if (placeholderEl) placeholderEl.classList.remove('hidden');
    }
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
        statusEl.innerHTML = metrics.is_flooded
            ? '<span class="inline-flex items-center gap-1.5 rounded-full bg-red-500/20 px-3 py-1 text-[10px] font-black text-red-400 uppercase tracking-widest"><i data-lucide="alert-triangle" class="h-3 w-3"></i> Khu vực Ngập</span>'
            : '<span class="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1 text-[10px] font-black text-emerald-400 uppercase tracking-widest"><i data-lucide="shield-check" class="h-3 w-3"></i> An toàn</span>';
    }

    const roadEl = document.getElementById('metric-road');
    const roadBarEl = document.getElementById('metric-road-bar');
    if (roadEl) roadEl.textContent = `${metrics.road_flood_ratio}%`;
    if (roadBarEl) {
        setTimeout(() => { roadBarEl.style.width = `${Math.min(metrics.road_flood_ratio, 100)}%`; }, 100);
    }

    const bldFloodEl = document.getElementById('metric-bld-flood');
    const bldTotalEl = document.getElementById('metric-bld-total');
    if (bldFloodEl) bldFloodEl.textContent = metrics.building_flooded_count;
    if (bldTotalEl) bldTotalEl.textContent = `/ ${metrics.building_total_count}`;

    const vehicleEl = document.getElementById('metric-vehicle');
    if (vehicleEl) vehicleEl.textContent = metrics.vehicle_on_flooded_road;

    const coverageEl = document.getElementById('metric-coverage');
    if (coverageEl) coverageEl.textContent = `${metrics.flood_coverage_percent}%`;

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ====================== CHAT LOCK/UNLOCK ======================

function lockChat() {
    isProcessing = true;
    if (analysisChatInputEl) {
        analysisChatInputEl.disabled = true;
        analysisChatInputEl.placeholder = "⏳ Đang xử lý, vui lòng chờ...";
    }
    if (analysisSendBtnEl) {
        analysisSendBtnEl.disabled = true;
        analysisSendBtnEl.classList.add('opacity-40', 'pointer-events-none');
    }
}

function unlockChat() {
    isProcessing = false;
    if (analysisChatInputEl) {
        analysisChatInputEl.disabled = false;
        analysisChatInputEl.placeholder = sessionHasImage
            ? "Nhập câu hỏi về ảnh đã tải lên..."
            : "Chọn ảnh rồi nhấn gửi để bắt đầu phân tích...";
    }
    if (analysisSendBtnEl) {
        analysisSendBtnEl.disabled = false;
        analysisSendBtnEl.classList.remove('opacity-40', 'pointer-events-none');
    }
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
        const lastMsg = s.lastReply || s.lastQuestion || "Phiên đánh giá mới";
        const time = s.updatedAt ? formatRelativeTime(new Date(s.updatedAt).getTime()) : "";

        return `
            <div onclick="loadSessionHistory('${s.sessionId}')" class="group relative flex flex-col gap-1 rounded-xl px-3 py-2.5 transition-all cursor-pointer ${isActive ? 'bg-brand-primary/10 border-l-2 border-brand-primary' : 'hover:bg-white/5'}">
                <div class="flex items-center justify-between">
                    <span class="text-[11px] font-bold tracking-tight ${isActive ? 'text-brand-primary' : 'text-ui-text'} truncate w-32">
                        ${s.sessionId.substring(0, 8)}...
                    </span>
                    <span class="text-[9px] font-medium text-ui-muted opacity-60">${time}</span>
                </div>
                <p class="text-[10px] leading-tight text-ui-muted truncate opacity-80 group-hover:opacity-100">
                    ${lastMsg.length > 50 ? lastMsg.substring(0, 50) + '...' : lastMsg}
                </p>
            </div>
        `;
    }).join('');
}

async function loadSessionHistory(id) {
    if (!id) return;

    sessionId = id;
    localStorage.setItem('session_id', id);
    socket.emit('registerSession', { sessionId });

    // Reset state
    sessionHasImage = false;
    currentMetrics = null;
    isProcessing = false;
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
            const dbSession = data.session;
            if (dbSession && dbSession.history && dbSession.history.length > 0) {
                analysisMessages = dbSession.history.map((h, i) => {
                    // Ưu tiên imageUrls (mảng), fallback về imageUrl (chuỗi đơn) nếu là dữ liệu cũ
                    let urls = h.imageUrls || (h.imageUrl ? [h.imageUrl] : []);
                    urls = urls.map(resolveImageUrl);

                    return {
                        id: i.toString(),
                        sender: (h.role === 'user' || h.sender === 'user') ? 'user' : 'bot',
                        text: h.content || h.text || '',
                        createdAt: h.createdAt ? new Date(h.createdAt).getTime() : Date.now(),
                        imageUrls: urls
                    };
                });
            } else {
                analysisMessages = [{
                    id: "1", sender: "bot",
                    text: "Phiên này chưa có lịch sử chat. Hãy tải ảnh lên để bắt đầu!",
                    createdAt: Date.now(), imageUrls: []
                }];
            }
            renderAnalysisMessages(true);
        }

        // Load tasks for this session to get metrics & session image
        const taskRes = await fetch(`${BACKEND_URL}/chat/tasks/${id}`);
        if (taskRes.ok) {
            const taskData = await taskRes.json();
            const tasks = taskData.tasks || [];
            if (tasks.length > 0) {
                const latestTask = tasks[0];
                currentJobId = latestTask.job_id || latestTask.jobId;
                localStorage.setItem('current_job_id', currentJobId);

                sessionHasImage = true;
                updateSessionImage(latestTask.image_url || latestTask.imageUrl);

                if (latestTask.metrics) {
                    currentMetrics = latestTask.metrics;
                    renderMetricsPanel(currentMetrics);
                } else {
                    renderMetricsPanel(null);
                }

                unlockChat();
                updateUploadButton();
            } else {
                sessionHasImage = false;
                updateSessionImage(null);
                renderMetricsPanel(null);
                unlockChat();
                updateUploadButton();
            }
        }

        if (activeView === 'gallery') renderGalleryForSession(id);
    } catch (err) {
        console.error('Failed to load history:', err);
        analysisMessages = [{
            id: "1", sender: "bot",
            text: "Không thể tải lịch sử. Hãy thử tạo phiên mới.",
            createdAt: Date.now(), imageUrls: []
        }];
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
        analysisViewEl.classList.remove('hidden');
        analysisViewEl.classList.add('flex');
        galleryViewEl.classList.add('hidden');
        galleryViewEl.classList.remove('flex');
        renderAnalysisMessages(true);
    } else {
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

    galleryContentEl.innerHTML = '<div class="text-center text-ui-muted py-20 animate-pulse">Đang tải dữ liệu gallery...</div>';

    try {
        const res = await fetch(`${BACKEND_URL}/chat/tasks/${sid}`);
        if (!res.ok) throw new Error('Failed to fetch tasks');
        const data = await res.json();
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
                            <img class="comparison-img-bottom absolute inset-0 w-full h-full object-cover" src="${resolveImageUrl(task.image_url || task.imageUrl)}" alt="Original" />
                            
                            <!-- Overlay layer (Mask - Always Pure now, overlaid with 70% opacity by CSS) -->
                            <img class="comparison-img-top absolute inset-0 w-full h-full object-cover" src="${resolveImageUrl(task.mask_all_overlay || task.maskAllOverlay)}" alt="Mask overlay" style="clip-path: inset(0 50% 0 0); opacity: 0.7;" />
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
    const statusBadge = metrics.is_flooded
        ? '<span class="rounded-full bg-red-500/20 px-2.5 py-1 text-[9px] font-black text-red-400 uppercase flex items-center gap-1"><i data-lucide="alert-triangle" class="h-3 w-3"></i> Ngập</span>'
        : '<span class="rounded-full bg-emerald-500/20 px-2.5 py-1 text-[9px] font-black text-emerald-400 uppercase flex items-center gap-1"><i data-lucide="shield-check" class="h-3 w-3"></i> An toàn</span>';

    return `
        <div class="flex flex-wrap items-center gap-3">
            ${statusBadge}
            <span class="text-[10px] font-bold text-ui-muted flex items-center gap-1"><i data-lucide="road" class="h-3 w-3 text-brand-primary"></i> Đường ngập: <strong class="text-brand-primary">${metrics.road_flood_ratio}%</strong></span>
            <span class="text-[10px] font-bold text-ui-muted flex items-center gap-1"><i data-lucide="building" class="h-3 w-3 text-red-400"></i> Nhà ngập: <strong class="text-red-400">${metrics.building_flooded_count}</strong>/${metrics.building_total_count}</span>
            <span class="text-[10px] font-bold text-ui-muted flex items-center gap-1"><i data-lucide="car" class="h-3 w-3 text-orange-400"></i> Xe: <strong class="text-orange-400">${metrics.vehicle_on_flooded_road}</strong></span>
            <span class="text-[10px] font-bold text-ui-muted flex items-center gap-1"><i data-lucide="droplets" class="h-3 w-3 text-brand-primary"></i> Phủ ngập: <strong class="text-brand-primary">${metrics.flood_coverage_percent}%</strong></span>
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
    currentJobId = '';
    localStorage.removeItem('current_job_id');
    socket.emit('registerSession', { sessionId });
    sessionHasImage = false;
    currentMetrics = null;
    isProcessing = false;

    if (metricsPanelEl) metricsPanelEl.classList.add('hidden');
    updateSessionImage(null);
    renderMetricsPanel(null);

    analysisMessages = [{
        id: "1", sender: "bot",
        text: "Phiên mới đã được tạo! Hãy tải ảnh UAV/drone lên để bắt đầu phân tích ngập lụt.",
        createdAt: Date.now(), imageUrls: []
    }];
    clearSelectedFiles();
    unlockChat();
    updateUploadButton();
    renderAnalysisMessages(true);
    fetchSessions();
}

function updateUploadButton() {
    if (analysisUploadTriggerEl) {
        // Thay đổi: Không khóa nút upload vĩnh viễn nữa. 
        // Chỉ khóa khi đang trong quá trình xử lý (isProcessing)
        if (isProcessing) {
            analysisUploadTriggerEl.disabled = true;
            analysisUploadTriggerEl.classList.add('opacity-30', 'cursor-not-allowed');
        } else {
            analysisUploadTriggerEl.disabled = false;
            analysisUploadTriggerEl.classList.remove('opacity-30', 'cursor-not-allowed');
            analysisUploadTriggerEl.title = sessionHasImage ? 'Tải ảnh mới để phân tích lại' : 'Tải ảnh lên để bắt đầu';
        }
    }
}

function renderAnalysisMessages(scrollToBottom = false) {
    if (!analysisChatHistoryEl) return;
    analysisChatHistoryEl.innerHTML = analysisMessages.map(msg => {
        const safeText = (msg.text || '').trim();
        const hasText = safeText.length > 0;
        const hasImages = msg.imageUrls && msg.imageUrls.length > 0;
        const isBot = msg.sender === "bot" || msg.sender === "assistant";
        const authorLabel = isBot ? "Neural Engine" : "Người dùng";

        const textHtml = hasText
            ? `<div class="rounded-2xl p-5 shadow-sm ${isBot ? "rounded-bl-none glass-panel" : "chat-bubble-user"}">
                    <p class="text-sm font-medium leading-relaxed whitespace-pre-wrap">${safeText.replace(/\n/g, '<br>')}</p>
               </div>`
            : '';

        const imagesHtml = hasImages
            ? `<div class="${hasText ? "mt-4 " : ""}grid gap-3 grid-cols-1">
                    ${msg.imageUrls.map(url => `<img src="${url}" class="max-h-72 w-full rounded-2xl border border-white/10 object-cover shadow-2xl cursor-pointer hover:opacity-90 transition-opacity" onclick="window.open('${url}', '_blank')" />`).join('')}
               </div>`
            : '';

        const progressHtml = (isBot && msg.progress !== undefined)
            ? `<div class="mt-3 w-full min-w-[200px]">
                    <div class="flex items-center justify-between mb-1.5">
                        <span class="text-[9px] font-black uppercase tracking-widest text-brand-primary flex items-center gap-1">
                            <span class="relative flex h-2 w-2">
                              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-primary opacity-75"></span>
                              <span class="relative inline-flex rounded-full h-2 w-2 bg-brand-primary"></span>
                            </span>
                            Neural Progress
                        </span>
                        <span class="text-[10px] font-black text-brand-primary">${msg.progress}%</span>
                    </div>
                    <div class="h-2 w-full bg-white/5 rounded-full overflow-hidden border border-white/5 p-[1px]">
                        <div class="h-full bg-gradient-to-r from-brand-primary/40 to-brand-primary rounded-full transition-all duration-700 cubic-bezier(0.4, 0, 0.2, 1)" style="width: ${msg.progress}%"></div>
                    </div>
                    ${msg.estSecondsRemaining > 0 ? `<p class="mt-1.5 text-[9px] font-bold text-ui-muted opacity-50 uppercase tracking-widest text-right animate-pulse">Còn khoảng ${msg.estSecondsRemaining}s...</p>` : ''}
               </div>`
            : '';

        const iconName = isBot ? "bot" : "user";

        return `
            <div class="flex gap-5 ${msg.sender === "user" ? "flex-row-reverse" : ""} animate-slide-up">
                <div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${isBot ? "bg-brand-primary/10 text-brand-primary" : "bg-white/5 text-ui-muted"}">
                    <i data-lucide="${iconName}" class="w-5 h-5"></i>
                </div>
                <div class="max-w-[80%]">
                    ${textHtml}
                    ${progressHtml}
                    ${imagesHtml}
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
            <button type="button" data-remove-index="${index}" class="preview-remove-btn absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black text-white opacity-0 transition-opacity group-hover:opacity-100" aria-label="Xóa ảnh">×</button>
        </div>
    `).join('');
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
    selectedFiles = [pastedImages[0]];
    renderSelectedPreviews();
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
    clearSelectedFiles();

    // Add user message
    analysisMessages.push({
        id: Date.now().toString(),
        sender: 'user',
        text: text || (filesToSend.length > 0 ? "📷 Đang phân tích ảnh..." : ""),
        createdAt: Date.now(),
        imageUrls: filesToSend.map(file => URL.createObjectURL(file))
    });

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
        updateUploadButton();

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
                    currentJobId = uploadData.jobId;
                    localStorage.setItem('current_job_id', currentJobId);
                }
                if (uploadData.sessionId) {
                    sessionId = uploadData.sessionId;
                    localStorage.setItem('session_id', sessionId);
                    socket.emit('registerSession', { sessionId });
                }
            } else {
                const errData = await uploadRes.json().catch(() => ({}));
                const lastBot = [...analysisMessages].reverse().find(m => m.sender === 'bot');
                if (lastBot) lastBot.text = `❌ Lỗi upload: ${errData.message || uploadRes.statusText}`;
                unlockChat();
                renderAnalysisMessages(true);
            }
            fetchSessions();
        } catch (error) {
            console.error('Pipeline error:', error);
            const lastBot = [...analysisMessages].reverse().find(m => m.sender === 'bot');
            if (lastBot) lastBot.text = `❌ Lỗi kết nối: ${error.message}`;
            unlockChat();
            renderAnalysisMessages(true);
        }
    } else {
        // Text-only follow-up (chat with VLM)
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
    if (e.key === 'Enter') handleSendMessage();
});
analysisUploadTriggerEl?.addEventListener('click', () => {
    if (!sessionHasImage && !isProcessing) analysisFileInputEl?.click();
});
analysisFileInputEl?.addEventListener('change', (e) => {
    if (sessionHasImage || isProcessing) return;
    const files = Array.from(e.target.files || []).filter(isImageFile);
    if (files.length > 0) {
        selectedFiles = [files[0]];
        renderSelectedPreviews();
    }
    analysisFileInputEl.value = '';
});
analysisPreviewsEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-index]');
    if (!btn) return;
    selectedFiles = [];
    renderSelectedPreviews();
});
document.addEventListener('paste', handleGlobalPaste);

themeToggleEl?.addEventListener('click', toggleTheme);
newSessionBtnEl?.addEventListener('click', createNewSession);

// ====================== INITIALIZATION ======================

document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    switchView('analysis');

    if (typeof lucide !== 'undefined') lucide.createIcons();

    if (sessionId) {
        loadSessionHistory(sessionId);
    }
    fetchSessions();
});

// Global Scope
window.switchView = switchView;
window.loadSessionHistory = loadSessionHistory;
