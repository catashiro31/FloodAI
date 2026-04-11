# Segmentation Worker

Thư mục nguồn: `services/segmentation_worker`

## Vai trò

- nhận `session_id`
- tải ảnh từ `task_image`
- chạy semantic segmentation
- upload mask lên storage
- ghi `metrics` và `mask_url` về `task_image`
- callback tiến độ và callback kết quả về gateway

## API

### `GET /health`

Trả trạng thái model đã load hay chưa.

### `POST /inference`

Body:

```json
{
  "session_id": "11111111-1111-1111-1111-111111111111",
  "callback_url": "http://localhost:5000/chat/webhook/segmentation",
  "progress_url": "http://localhost:5000/chat/webhook/progress"
}
```

### `GET /status/{session_id}`

Trạng thái in-memory theo session.

## Cấu hình chính

Biến env đáng chú ý:

- `PORT`
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `SUPABASE_TABLE_NAME=task_image`
- `SUPABASE_MASK_BUCKET_NAME`

## File quan trọng

- `api.py`
- `model_handler.py`
- `inference.py`
- `utils/segmentation/db_handler.py`
- `utils/segmentation/compute_metrics.py`

## Kết quả đầu ra

- `mask_url` / `mask_all_overlay`
- `metrics`
- `status=success_segmentation`

Metrics bao gồm tối thiểu:

- `is_flooded`
- `flood_coverage_percent`
- `road_flood_ratio`
- `building_flooded_count`
- `building_total_count`
- `vehicle_on_flooded_road`
