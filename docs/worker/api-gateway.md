# API Gateway

Thư mục nguồn: `apps/api-gateway`

## Vai trò

- nhận upload và follow-up từ frontend
- tạo task trong Supabase
- gọi segmentation worker và reasoning worker
- xử lý webhook callback
- phát realtime status/reply qua Socket.IO

## HTTP routes chính

### `POST /chat`

Gửi message HTTP thông thường.

### `POST /chat/message`

Alias cho flow follow-up.

### `POST /chat/upload`

Upload ảnh đầu phiên.

Headers hỗ trợ:

- `x-client-id`
- `x-session-id`

Body:

- `file`
- `question` tùy chọn

### `POST /chat/webhook/segmentation`

Webhook từ segmentation worker.

### `POST /chat/webhook/progress`

Webhook tiến độ segmentation.

### `POST /chat/webhook/vlm`

Webhook từ reasoning worker.

### `GET /chat/status/:jobId`

Lấy trạng thái một reasoning task.

### `GET /chat/sessions`

Danh sách session gần đây.

### `GET /chat/sessions/:sessionId`

Chi tiết session và lịch sử.

### `GET /chat/tasks/:sessionId`

Danh sách task theo session để frontend hydrate ảnh, mask, metrics.

### `GET /chat/health`

Health check đơn giản.

## Realtime

Gateway Socket.IO hỗ trợ:

- `registerSession`
- `sendMessage`

Gateway emit về client:

- `uploadStatus`
- `receiveMessage`

## File quan trọng

- `src/chat/chat.controller.ts`
- `src/chat/chat.service.ts`
- `src/tasks/tasks.service.ts`
- `src/orchestration`
- `src/realtime`
