# FloodAI Web Chat

UI chat tĩnh (HTML/CSS/JS) để upload ảnh và nhận phân tích realtime từ API gateway qua Socket.IO.

## 1) Cấu trúc
- `index.html`: layout UI + Tailwind CDN
- `style.css`: theme variables + glassmorphism
- `script.js`: logic upload, socket, session storage

## 2) Cấu hình backend
`script.js` tự tính `BACKEND_URL` theo thứ tự:
1. `window.FLOODGUARD_BACKEND_URL`
2. Nếu chạy qua HTTP: `${protocol}//${hostname}:5000`
3. Fallback: `http://localhost:5000`

Có thể set trước khi load script:
```html
<script>
  window.FLOODGUARD_BACKEND_URL = "http://localhost:5000";
</script>
```

## 3) Luồng hoạt động
- Upload ảnh -> `POST /chat/upload` (multipart)
- Theo dõi status qua Socket.IO event `uploadStatus`
- Nhận câu trả lời qua `receiveMessage`
- Follow-up câu hỏi: `sendMessage` event (kèm `jobId` + `sessionId`)

## 4) Session & storage
- `session_id` và `current_job_id` lưu trong `localStorage`.
- Nút "New Session" tạo `session_id` mới và reset lịch sử.

## 5) Chạy local
Mở trực tiếp `index.html` hoặc chạy web server tĩnh:
```powershell
python -m http.server 5173
```
Sau đó truy cập `http://localhost:5173`.
