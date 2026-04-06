# FloodNet Segmentation API

API bất đồng bộ chạy segmentation ngập lụt từ ảnh đầu vào. Service đọc `job_id` từ Supabase, tải ảnh, chạy model, upload mask lên Supabase Storage và callback trạng thái về gateway.

## 1) Tổng quan
- Runtime chính: FastAPI (`api.py`)
- Job worker: `run_segmentation_task(...)` trong `model_handler.py`
- DB + Storage: Supabase (`db_handler.py`)
- Helper: `file_handler.py`
- Model weight mặc định: `best_heavy_hybrid_glnet.pth`
- Port mặc định: `8080`

## 2) Cấu trúc chính
- `api.py`: định nghĩa endpoint, enqueue background task
- `model_handler.py`: tải model, download ảnh, chạy inference, upload mask, callback
- `db_handler.py`: query/update Supabase, upload file lên bucket
- `file_handler.py`: decode base64 và parse tên file
- `inference.py`: kiến trúc model + `ComprehensiveVisualizer.visualize_all(...)`

## 3) Biến môi trường
Tạo `.env` với các biến:
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `SUPABASE_TABLE_NAME` (mặc định `tasks`)
- `SUPABASE_BUCKET_NAME` (mặc định `masks`)
- `PORT` (mặc định `8080`)

## 4) Cài đặt và chạy local
```powershell
python api.py
```

## 5) API Endpoints
### GET `/health`
Kiểm tra service và model.

### POST `/inference`
Queue job theo `job_id`.
Request body:
```json
{ "job_id": "uuid", "callback_url": "https://.../chat/webhook/segmentation" }
```

### GET `/status/{job_id}`
Trả trạng thái trong bộ nhớ `job_status`.

## 6) Luồng xử lý
1. Gateway gọi `POST /inference` với `job_id` + `callback_url`.
2. Worker lấy `image_url` (hoặc `url_image`) từ bảng `tasks`.
3. Chạy segmentation, tạo `mask_all_overlay`.
4. Upload mask lên bucket `masks` và cập nhật DB.
5. Callback kết quả về gateway.

## 7) Schema Supabase tối thiểu
### Bảng `tasks`
Cần có:
- `job_id` (uuid)
- `image_url` hoặc `url_image`
- `status`
- `mask_all_overlay` (lưu URL output)

### Bucket storage
- Bucket: `masks`
- Phải có quyền upload + public URL.

## 8) Lưu ý
- `job_status` lưu RAM nên mất khi restart.
- Nếu ảnh đầu vào không public hoặc URL sai, job sẽ chuyển `error`.
