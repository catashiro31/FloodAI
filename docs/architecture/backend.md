# Backend Architecture

## Tổng quan

Backend hiện tại gồm 3 thành phần:

- `apps/api-gateway`: NestJS gateway, orchestration, realtime, persistence
- `services/segmentation_worker`: FastAPI worker sinh mask và metrics
- `services/reasoning_worker`: FastAPI worker gọi Ollama để tạo phân tích VLM

## Luồng xử lý

1. Web chat upload ảnh qua `POST /chat/upload`.
2. Gateway tạo `session`, `task_reasoning` đầu tiên và `task_image`.
3. Gateway kích hoạt segmentation worker bằng `session_id`.
4. Segmentation worker cập nhật `task_image` với:
   - `mask_url` / `mask_all_overlay`
   - `metrics`
   - `status`
5. Gateway nhận webhook segmentation, emit realtime progress/status, rồi enqueue reasoning worker.
6. Reasoning worker đọc:
   - `task_reasoning` theo `job_id`
   - `task_image.metrics` theo `session_id`
7. Gateway nhận webhook VLM, lưu phản hồi vào lịch sử hội thoại và bắn realtime về frontend.

## Trách nhiệm dữ liệu

### `sessions`

- định danh hội thoại theo `session_id`
- lưu `context`, `last_question`, `last_reply`

### `task_reasoning`

- định danh từng lượt reasoning theo `job_id`
- giữ `session_id`, `question`, `image_url`, `mask_url`, `vlm_analysis`, `status`

### `task_image`

- giữ trạng thái xử lý ảnh theo `session_id`
- chứa `image_url`, `mask_url`, `metrics`

### `session_history`

- lưu lịch sử user/assistant theo session
- hỗ trợ cả `image_urls` cho bubble attachment trong frontend

## Realtime

Gateway dùng Socket.IO để đẩy:

- `uploadStatus`: queued, processing, segmentation complete, errors
- `receiveMessage`: câu trả lời VLM hoặc message trạng thái trung gian

Mapping realtime nằm trong:

- `src/realtime/realtime.gateway.ts`
- `src/realtime/realtime.service.ts`

## Điểm thiết kế đáng chú ý

- session-first: một session gắn với một ảnh nguồn
- follow-up reasoning tạo `job_id` mới nhưng tái sử dụng `session_id`
- frontend đọc danh sách task theo session để hydrate lại metrics và gallery
- reasoning ưu tiên metrics từ `task_image`, không tự tính lại từ mask
