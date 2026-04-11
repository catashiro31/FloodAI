# Setup

Tài liệu này gom phần chuẩn bị môi trường cho toàn bộ repo `FloodAI`.

## 1. Yêu cầu chung

- Node.js 20+ cho `apps/api-gateway`
- Python 3.11+ cho `services/*_worker` và `model/`
- Ollama cho reasoning worker
- Supabase project có các bảng:
  - `sessions`
  - `task_reasoning`
  - `task_image`
  - `session_history`

## 2. API Gateway

Thư mục: `apps/api-gateway`

```bash
cd apps/api-gateway
npm install
```

Biến môi trường cần có tối thiểu:

- cấu hình Supabase
- URL callback/webhook cho segmentation và VLM nếu chạy tách service
- cấu hình realtime/gateway port

Xem mã nguồn chính ở:

- `src/chat`
- `src/tasks`
- `src/orchestration`
- `src/realtime`

## 3. Segmentation Worker

Thư mục: `services/segmentation_worker`

```bash
pip install -r requirements.segmentation.txt
```

Cần chuẩn bị:

- file model `best_ssl_model.pth`
- biến môi trường Supabase
- `SUPABASE_TABLE_NAME=task_image`
- `SUPABASE_MASK_BUCKET_NAME=<bucket-mask>`

File cấu hình mẫu dùng chung:

- `env.sample` ở root repo

## 4. Reasoning Worker

Thư mục: `services/reasoning_worker`

```bash
pip install -r requirements.reasoning.txt
```

Cần chuẩn bị:

- Ollama đang chạy
- model Ollama đã pull, mặc định: `gemma4:e2b-it-q4_K_M`
- biến môi trường Supabase
- `SUPABASE_TABLE_NAME=task_reasoning`
- `TASK_IMAGE_TABLE_NAME=task_image`
- `SESSION_TABLE_NAME=sessions`

File cấu hình mẫu dùng chung:

- `env.sample` ở root repo

## 5. Web Chat

Thư mục: `apps/web-chat`

Web chat là static app HTML/CSS/JS, không có bước build bắt buộc.

Có thể cấu hình backend bằng:

```html
<script>
  window.FLOODGUARD_BACKEND_URL = "http://localhost:5000";
</script>
```

Nếu không set, frontend sẽ tự suy URL backend theo hostname hiện tại và port `5000`.

## 6. Training / Model

Thư mục: `model`

```bash
pip install -r requirements.model.txt
```

Dataset mặc định:

- `FloodNet-Supervised_v1.0`

Các biến cấu hình chính nằm trong:

- `model/config.py`
- `model/semi_supervised_learning/config_ssl.py`
