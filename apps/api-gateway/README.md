# FloodAI API Gateway

Gateway NestJS nhận upload ảnh, tạo task trong Supabase, gọi worker segmentation + VLM, đồng thời phát realtime status/answer qua Socket.IO cho UI.

## 1) Thành phần chính
- `ChatModule`: API upload, webhook, follow-up Q&A
- `TasksModule`: quản lý trạng thái task trong DB
- `ConversationModule`: lưu sessions/history
- `OrchestrationModule`: gọi segmentation + VLM workers
- `RealtimeModule`: Socket.IO gateway
- `SharedSupabaseModule`: kết nối Supabase

## 2) Biến môi trường
Cần cấu hình `.env` (hoặc environment runtime):
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `SUPABASE_IMAGES_BUCKET` hoặc `SUPABASE_BUCKET` (mặc định `images`)
- `SUPABASE_TASKS_TABLE` (mặc định `tasks`)
- `SUPABASE_SESSIONS_TABLE` (mặc định `sessions`)
- `SEGMENT_SERVICE_URL` (endpoint segmentation worker)
- `VLM_SERVICE_URL` (endpoint reasoning worker)
- `GATEWAY_BASE_URL` (mặc định `http://localhost:5000`)
- `CORS_ORIGIN` (danh sách origin, phân tách bằng dấu phẩy)
- `BACKEND_PORT` hoặc `PORT` (mặc định `5000`)

## 3) Chạy local
```powershell
npm install
npm run start:dev
```

## 4) HTTP Endpoints
Base path: `/chat`

- `POST /chat` và `POST /chat/message`
  - Body: `{ message, jobId?, sessionId?, reset? }`
  - Dùng cho follow-up question (VLM).

- `POST /chat/upload`
  - Multipart: `file`, `question` (optional)
  - Headers: `x-client-id`, `x-session-id` (optional)

- `POST /chat/webhook/segmentation`
  - Nhận callback từ segmentation worker.

- `POST /chat/webhook/vlm`
  - Nhận callback từ reasoning worker.

- `GET /chat/status/:jobId`
  - Trả trạng thái task + session.

- `GET /chat/sessions?limit=50`
  - Liệt kê sessions gần nhất.

- `GET /chat/sessions/:sessionId`
  - Trả chi tiết session.

- `GET /chat/health`
  - Health check gateway.

## 5) WebSocket Events
- Client emit `registerSession` `{ sessionId }`
- Client emit `sendMessage` `{ message, jobId?, sessionId?, reset? }`
- Server emit `uploadStatus` `{ status, details, timestamp }`
- Server emit `receiveMessage` `{ reply, imageUrls, jobId, createdAt }`

## 6) Supabase schema
Tham khảo `supabase/schema.sql`.
Bảng chính: `tasks` + `sessions`.

## 7) Luồng orchestration
1. Upload ảnh -> tạo `task` (status `queued`).
2. `OrchestrationService` gọi segmentation worker.
3. Nhận callback segmentation -> cập nhật `mask_all_overlay`.
4. Gọi reasoning worker -> cập nhật `vlm_analysis`.
5. Realtime status + reply trả về UI.
