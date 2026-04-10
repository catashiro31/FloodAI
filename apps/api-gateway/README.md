# FloodAI API Gateway

Gateway NestJS của FloodAI nhận ảnh từ frontend, lưu trạng thái lên Supabase, gọi segmentation worker và VLM worker, rồi phát tiến độ qua Socket.IO. Backend không còn dùng DB local hay lưu ảnh local.

## Kiến trúc dữ liệu

Schema nguồn nằm tại [database/schema.sql](/F:/Code/NCKH_IT_2026/FloodAI/apps/api-gateway/database/schema.sql).

### `sessions`

Một session tương ứng với một ca phân tích ảnh.

- `session_id`
- `context`
- `last_question`
- `last_reply`
- `created_at`
- `updated_at`

### `task_image`

Mỗi upload tạo một snapshot ảnh riêng gắn với `job_id` của reasoning task tương ứng.
Nhờ vậy một session có thể có nhiều ảnh theo thời gian mà không làm ghi đè dữ liệu cũ.

- `job_id`
- `session_id`
- `image_url`
- `status`
- `mask_all_overlay`
- `metrics`
- `error_code`
- `error_message`
- `segmentation_callback_at`
- `created_at`
- `updated_at`

### `task_reasoning`

Một session có nhiều lượt reasoning, mỗi lượt có `job_id` riêng.

- `job_id`
- `session_id`
- `status`
- `question`
- `vlm_analysis`
- `error_code`
- `error_message`
- `vlm_callback_at`
- `created_at`
- `updated_at`

### `session_history`

Lịch sử chat được tách thành từng dòng để dễ truy vết theo `session_id` và `reasoning_task_id`.

- `history_id`
- `session_id`
- `reasoning_task_id`
- `role`
- `content`
- `image_urls`
- `created_at`

## Luồng hoạt động backend

### 1. Upload ảnh

Frontend gọi `POST /chat/upload`.

Gateway sẽ:

1. Tạo hoặc tái sử dụng `session_id`.
2. Tạo `sessions` nếu session chưa có.
3. Chỉ nhận ảnh `png`, `jpeg`, `webp` và upload lên Supabase Storage.
4. Tạo `task_reasoning` đầu tiên với `job_id` mới.
5. Tạo snapshot `task_image` theo chính `job_id` đó với trạng thái `queued`.
6. Ghi một row `session_history` cho tin nhắn đầu tiên của user, gắn với `reasoning_task_id` vừa tạo.
7. Gọi segmentation worker với `job_id` của reasoning task đầu tiên.

Response vẫn giữ `jobId` để tương thích cũ, đồng thời trả thêm `reasoningTaskId`.

### 2. Segmentation

Segmentation worker callback về:

- `POST /chat/webhook/progress`
  - Gateway chỉ emit realtime progress.
- `POST /chat/webhook/segmentation`
  - Gateway cập nhật `task_image`.
  - Đồng thời cập nhật `task_reasoning` đầu tiên sang `success_segmentation` hoặc `error`.

Vì `task_reasoning.job_id` được dùng làm `jobId` xuyên suốt, frontend và worker vẫn có một id ổn định để theo dõi pipeline.

### 3. Reasoning

Sau khi segmentation thành công, gateway gọi VLM worker.

Khi VLM callback về `POST /chat/webhook/vlm`, gateway sẽ:

1. Cập nhật row tương ứng trong `task_reasoning`.
2. Ghi thêm một row `session_history` cho câu trả lời assistant, gắn đúng `reasoning_task_id`.
3. Cập nhật `sessions.last_reply`.
4. Emit realtime reply về client.

### 4. Follow-up chat

Khi user hỏi tiếp trong cùng session:

1. Frontend gửi `sessionId` và `jobId` hiện tại.
2. Gateway tạo một `task_reasoning` mới với `job_id` mới.
3. Gateway clone snapshot `task_image` từ `jobId` hiện tại sang `job_id` mới để giữ ngữ cảnh ảnh/mask bất biến cho từng lượt reasoning.
4. Gateway ghi row `session_history` của user, trỏ tới `reasoning_task_id` mới.
5. Gateway gọi thẳng VLM worker, không chạy segmentation lại.
6. Khi callback xong, gateway ghi row trả lời của assistant vào `session_history`.

Nhờ vậy một session có thể có nhiều reasoning task và nhiều image snapshot, nhưng mỗi reasoning task luôn giữ đúng ảnh/mask của chính nó.

## HTTP API

Base path: `/chat`

- `POST /chat/upload`
  - Multipart form-data: `file`, `question?`, `sessionId?`
  - `file` phải là ảnh `png`, `jpeg`, hoặc `webp`
  - Trả `jobId`, `reasoningTaskId`, `sessionId`, `imageUrl`.
- `POST /chat`
- `POST /chat/message`
  - Body: `{ message, jobId, sessionId, reset? }`
  - Tạo một reasoning task mới cho follow-up.
- `POST /chat/webhook/segmentation`
- `POST /chat/webhook/progress`
- `POST /chat/webhook/vlm`
- `GET /chat/status/:jobId`
  - Trả trạng thái reasoning task, kèm `imageStatus`, dữ liệu ảnh và session đã hydrate.
- `GET /chat/sessions`
- `GET /chat/sessions/:sessionId`
- `GET /chat/tasks/:sessionId`
  - Trả danh sách reasoning task trong session.
- `GET /chat/health`

## WebSocket

- Client emit `registerSession` `{ sessionId }`
- Client emit `sendMessage` `{ message, jobId, sessionId, reset? }`
- Server emit `uploadStatus`
- Server emit `receiveMessage`

## Biến môi trường

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_KEY`
- `SUPABASE_BUCKET` hoặc `SUPABASE_IMAGES_BUCKET`
- `SUPABASE_ORIGINALS_PREFIX`
- `SUPABASE_SESSIONS_TABLE`
- `SUPABASE_TASK_IMAGE_TABLE`
- `SUPABASE_TASK_REASONING_TABLE`
- `SUPABASE_SESSION_HISTORY_TABLE`
- `SEGMENT_SERVICE_URL`
- `VLM_SERVICE_URL`
- `GATEWAY_BASE_URL`
- `WORKER_WEBHOOK_SECRET` hoặc `WEBHOOK_SECRET`
- `CORS_ORIGIN`
- `BACKEND_PORT` hoặc `PORT`

Nếu `WORKER_WEBHOOK_SECRET` hoặc `WEBHOOK_SECRET` được cấu hình, gateway sẽ tự gắn `?token=...` vào callback URL gửi cho worker và chỉ chấp nhận webhook có secret hợp lệ.

## Chạy local

```powershell
npm install --ignore-scripts
npm run start:dev
```

Ghi chú:

- Trong môi trường PowerShell hiện tại, `npm install` thường cần `--ignore-scripts` vì một dependency cũ có postinstall không tương thích.
- Backend không còn phụ thuộc `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.
- Backend không còn phục vụ `/static` hay thư mục `uploads/`.
