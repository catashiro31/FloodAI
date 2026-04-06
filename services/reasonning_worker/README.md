# FloodNet VLM Reasoning API

Service suy luận bằng VLM (OpenVINO GenAI) dựa trên ảnh đầu vào + mask segmentation. API nhận `job_id`, tải ảnh + mask, tạo context, sinh câu trả lời và callback về gateway.

## 1) Tổng quan
- Runtime chính: FastAPI (`api.py`)
- Worker: `run_reasoning_task(...)` trong `model_handler.py`
- Model: OpenVINO GenAI VLM (`./qwen2-quant`)
- Tóm tắt hội thoại: LSA (sumy)
- DB + session store: Supabase (`db_handler.py`)
- Port mặc định: `8000`

## 2) Cấu trúc chính
- `api.py`: endpoints, lifecycle load model
- `model_handler.py`: build prompt, gọi VLM, callback, quản lý memory hội thoại
- `image_analizer.py`: thống kê pixel từ mask overlay (road/building)
- `file_handler.py`: tải ảnh từ URL
- `db_handler.py`: query/update bảng `tasks` + `sessions`

## 3) Biến môi trường
Tạo `.env` với các biến:
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `SUPABASE_TABLE_NAME` (mặc định `tasks`)
- `STATUS_COLUMN` (mặc định `status`)
- `VLM_OUTPUT_COLUMN` (mặc định `vlm_analysis`)
- `SESSION_TABLE_NAME` (mặc định `sessions`)
- `MASK_SOURCE_COLUMN` (mặc định `mask_all_overlay`)
- `PORT` (mặc định `8000`)

## 4) Cài đặt và chạy local
```powershell
python api.py
```

## 5) API Endpoints
### GET `/health`
Kiểm tra service, model và DB.

### GET `/model_status`
Hiển thị số job trong RAM và job đang xử lý.

### POST `/reasoning`
Queue job reasoning theo `job_id`.
Request body:
```json
{
  "job_id": "uuid",
  "session_id": "string",
  "question": "string",
  "callback_url": "https://.../chat/webhook/vlm",
  "reset": false
}
```

### GET `/status/{job_id}`
Trả trạng thái trong RAM hoặc fallback DB.

## 6) Luồng xử lý
1. API đọc `job_id`, lấy `image_url` và mask từ DB.
2. Tính mask metrics bằng `image_analizer.py`.
3. Build context + prompt, gọi VLM.
4. Lưu `vlm_analysis` + trạng thái vào DB.
5. Callback kết quả về gateway, kèm history.

## 7) Schema Supabase tối thiểu
### Bảng `tasks`
Cần có:
- `job_id`
- `image_url` hoặc `url_image`
- `status`
- `vlm_analysis`
- Ít nhất một trong các cột mask:
  - `mask_all_overlay`
  - `mask_Road-Flooded_overlay`
  - `mask_Building-Flooded_overlay`
  - `mask_url`

### Bảng `sessions`
Cần có:
- `session_id`
- `job_id`
- `context` (json)
- `history` (json)
- `last_question`, `last_reply`

## 8) Lưu ý
- Memory hội thoại lưu theo `session_id` trong RAM; restart sẽ mất cache nhưng DB vẫn giữ history.
- Nếu thiếu mask hoặc ảnh, service sẽ trả lỗi và cập nhật `error_code` trong DB.
