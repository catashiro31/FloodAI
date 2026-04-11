# Run

Tài liệu này mô tả cách chạy các thành phần chính theo chế độ local.

## 1. Chạy API Gateway

Từ root repo:

```bash
npm run gateway:dev
```

Hoặc chạy trực tiếp trong service:

```bash
cd apps/api-gateway
npm run start:dev
```

Mặc định gateway phục vụ các route `chat/*` và Socket.IO realtime.

## 2. Chạy Segmentation Worker

Từ root repo:

```bash
npm run worker:segmentation
```

Hoặc:

```bash
python -m services.segmentation_worker.api
```

API chính:

- `POST /inference`
- `GET /status/{session_id}`
- `GET /health`

## 3. Chạy Reasoning Worker

Từ root repo:

```bash
npm run worker:reasoning
```

Hoặc:

```bash
python -m services.reasoning_worker.api
```

API chính:

- `POST /reasoning`
- `GET /status/{job_id}`
- `GET /health`
- `GET /model_status`

## 4. Chạy Web Chat

```bash
cd apps/web-chat
python -m http.server 5173
```

Truy cập:

- `http://localhost:5173`

Frontend dùng:

- `POST /chat/upload`
- `GET /chat/sessions`
- `GET /chat/sessions/:sessionId`
- `GET /chat/tasks/:sessionId`
- Socket.IO events `uploadStatus` và `receiveMessage`

## 5. Chạy huấn luyện model thường

```bash
python model/train.py
```

Các baseline trong `model/others` có thể chạy trực tiếp:

```bash
python model/others/deeplabv3plus.py
python model/others/unetplusplus.py
python model/others/pspnet.py
python model/others/segformerb4.py
```

## 6. Chạy huấn luyện SSL

```bash
python model/semi_supervised_learning/train_ssl.py
```

## 7. Kiểm tra nhanh

- Gateway: `npm test`
- Reasoning worker: `python -m unittest services.reasoning_worker.tests.test_model_handler services.reasoning_worker.tests.test_api`
- Segmentation worker: `python -m unittest services.segmentation_worker.tests.test_model_handler services.segmentation_worker.tests.test_api`
