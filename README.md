# FloodAI - Ứng dụng học sâu đánh giá thiệt hại do lũ lụt từ ảnh UAV

## Giới thiệu
FloodAI là hệ thống phân tích ảnh UAV để nhận diện vùng ngập, trích xuất mặt nạ (segmentation) và sinh báo cáo tình huống bằng mô hình VLM. Kiến trúc gồm một gateway (NestJS), hai worker AI (segmentation + reasoning), và giao diện web chat.

## Mục lục
- [Cấu trúc dự án](#cau-truc-du-an)
- [Luồng xử lý](#luong-xu-ly)
- [Tài liệu theo mục](#tai-lieu-theo-muc)
- [Thành viên nhóm](#thanh-vien-nhom)

## Cấu trúc dự án
```
FloodAI/
├── apps/
│   ├── api-gateway/             # NestJS gateway + orchestration + realtime
│   └── web_chat/                # UI chat (static HTML/CSS/JS)
├── services/
│   ├── segmentation_worker/     # FastAPI segmentation worker
│   └── reasonning_worker/       # FastAPI VLM reasoning worker
├── libs/                        # Shared types, SDK, common utils
│   ├── shared-types/
│   └── ai-utils/
├── utils/                       # Script/tooling dùng chung cho dev + ops
│   ├── python/                  # helpers cho training/inference
│   ├── node/                    # helpers cho gateway/build
│   └── docker/                  # entrypoints, healthcheck scripts
├── cicd/                        # CI/CD pipelines & scripts
│   ├── github-actions/          # workflow yaml
│   ├── gitlab/                  # .gitlab-ci.yml hoặc include templates
│   ├── jenkins/                 # Jenkinsfile/groovy pipelines
│   └── scripts/                 # build/test/deploy shell scripts
├── monitoring/                  # Monitoring + observability
│   ├── prometheus/              # scrape configs + rules
│   ├── grafana/                 # dashboards + datasources
│   ├── loki/                    # logging stack
│   ├── alertmanager/            # alert routing
│   └── otel-collector/          # traces/metrics/logs collection
├── deploy/                      # Deployment manifests
│   ├── docker/                  # Dockerfiles, compose, entrypoints
│   ├── k8s/                     # k8s manifests (dev/staging/prod)
│   └── terraform/               # hạ tầng cloud
├── configs/                     # Runtime config, logging, env samples
│   ├── env/
│   └── logging/
├── docs/                        # Kiến trúc, API, runbooks
│   ├── architecture/
│   ├── api/
│   └── runbooks/
├── model/                       # model vlm and semantic segmentation
├── tests/                       # unit/integration/e2e
├── .env.example
├── docker-compose.yml
├── .gitignore
└── README.md
```

## Cấu trúc mở rộng đề xuất
Mẫu cấu trúc đầy đủ để mở rộng dự án (bao gồm `cicd`, `monitoring`, `utils`):

## Luồng xử lý
1. Client upload ảnh hoặc gửi câu hỏi qua `apps/web_chat`.
2. Gateway `apps/api-gateway` tạo `task` trong Supabase, upload ảnh vào bucket.
3. Gateway gọi segmentation worker (`services/segmentation_worker`).
4. Segmentation worker tạo mask và callback về gateway.
5. Gateway gọi reasoning worker (`services/reasonning_worker`) để sinh phân tích VLM.
6. Gateway cập nhật DB và bắn realtime status/answer qua Socket.IO cho UI.

## Hướng dẫn chạy dự án với Docker (Dành cho Developer/Tester)

Dự án đã được cấu hình Docker Compose đầy đủ. Bạn không cần phải cài đặt Node.js hay Python thủ công. 

### 1. Yêu cầu hệ thống
- Đã cài đặt [Docker](https://www.docker.com/) và Docker Compose.
- File model trọng số AI: `model/best_ssl_model.pth` (Cần pull từ Git hoặc tải đặt đúng vào thư mục `model/`).
- File cấu hình môi trường `.env.docker`.

### 2. Các bước chạy
Mở terminal tại thư mục gốc của dự án và chạy:
```bash
docker compose up -d --build
```

**Docker Compose sẽ tự động thực hiện:**
- Khởi tạo Database (PostgreSQL) kèm dữ liệu từ schema.
- Kéo bộ Ollama model phục vụ sinh text (VLM).
- Xây dựng (Build) Gateway Backend (NestJS).
- Cài đặt thư viện và khởi chạy AI Worker (Python FastAPI).
- Cung cấp giao diện Frontend Web.

### 3. Truy cập hệ thống
- Giao diện Web (Chat): [http://localhost:3000](http://localhost:3000)
- API Gateway (NestJS): [http://localhost:5000](http://localhost:5000)

### 4. Code và Hot-reload
- Các thư mục source code (`apps/web_chat`, `services/segmentation_worker`, `apps/api-gateway`) đều được mount trực tiếp vào container. Bạn chỉ cần sửa code trên máy chủ (host), thay đổi sẽ **lập tức có hiệu lực** mà không cần build lại.
- Để xem log quá trình dự đoán AI (hoặc kiểm tra lỗi): `docker compose logs -f worker`
- Tắt hệ thống: `docker compose down`

## Tài liệu theo mục
- `apps/api-gateway/README.md`: Gateway, API endpoints, realtime flow, env config.
- `apps/web_chat/README.md`: UI chat, cấu hình backend, socket events.
- `services/segmentation_worker/README.md`: Segmentation API và Supabase schema tối thiểu.
- `services/reasonning_worker/README.md`: VLM reasoning API, session store, mask metrics.
- `apps/api-gateway/supabase/schema.sql`: Schema bảng `tasks` và `sessions`.
- `scripts/processing_data.py`: Script chia dữ liệu FloodNet cho segmentation.

## Thành viên nhóm
- [Đỗ Văn Tiến](https://github.com/catashiro31)
- [Trương Văn Hoàng](https://github.com/trhoaq)
- [Bùi Tuấn Anh]()
- [Nguyễn Đức Vũ]()

## Lời cảm ơn
- Xin cảm ơn cô [Nguyễn Thu Hường]() đã hướng dẫn trong quá trình thực hiện.
- Dự án sử dụng bộ dữ liệu FloodNet. Xin cảm ơn nhóm tác giả đã công bố dữ liệu.
