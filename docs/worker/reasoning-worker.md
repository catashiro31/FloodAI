# Reasoning Worker

Thư mục nguồn: `services/reasoning_worker`

## Vai trò

- nhận `job_id` và `session_id`
- đọc bản ghi reasoning từ `task_reasoning`
- đọc `metrics` từ `task_image` theo `session_id`
- gọi Ollama để sinh mô tả/phân tích
- lưu câu trả lời vào `task_reasoning`
- callback về gateway

## API

### `GET /health`

Kiểm tra kết nối DB và model Ollama.

### `GET /model_status`

Hiển thị danh sách job đang xử lý trong memory.

### `POST /reasoning`

Body:

```json
{
  "job_id": "11111111-1111-1111-1111-111111111111",
  "session_id": "22222222-2222-2222-2222-222222222222",
  "question": "Can you focus on the eastern bridge?",
  "callback_url": "http://localhost:5000/chat/webhook/vlm",
  "reset": false
}
```

### `GET /status/{job_id}`

Trạng thái reasoning theo `job_id`.

## Cấu hình chính

Biến env đáng chú ý:

- `PORT`
- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL`
- `OLLAMA_TIMEOUT_SECONDS`
- `OLLAMA_MAX_CONCURRENCY`
- `SUPABASE_TABLE_NAME=task_reasoning`
- `TASK_IMAGE_TABLE_NAME=task_image`
- `SESSION_TABLE_NAME=sessions`
- `MASK_SOURCE_COLUMN=mask_url`

## File quan trọng

- `api.py`
- `model_handler.py`
- `utils/reasoning/db_handler.py`
- `utils/reasoning/file_handler.py`

## Hành vi hiện tại

- không dùng `sumy`
- không còn phụ thuộc `image_analizer`
- summary conversation dùng logic nội bộ nhẹ
- định lượng dựa trên `task_image.metrics`, không tự suy lại từ mask
