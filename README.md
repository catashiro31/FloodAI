# FloodAI

FloodAI là hệ thống phân tích ảnh UAV cho bài toán lũ lụt, gồm gateway NestJS, web chat tĩnh, segmentation worker, reasoning worker và mã huấn luyện model.

## Cấu trúc dự án
```
FloodAI/
├── apps/
│   ├── api-gateway/             # NestJS gateway + orchestration + realtime
│   └── web-chat/                # UI chat (static HTML/CSS/JS)
├── services/
│   ├── segmentation_worker/     # FastAPI segmentation worker
│   └── reasoning_worker/        # FastAPI VLM reasoning worker
├── utils/                       
│   ├── reasoning/               # helpers reasoning worker
│   └── segmentation/            # helpers segmentation worker
├── docs/                        # tài liệu tập trung
│   ├── architecture/
│   ├── model/
│   ├── worker/
│   └── tutorial/
├── model/                       # model segmentation
├── env.sample
├── .gitignore
├── requirements.reasoning.txt
├── requirements.segmentation.txt
├── requirements.model.txt
├── AGENTS.md
└── README.md
```
## Tài liệu

### Tutorial

- [Setup](docs/tutorial/setup.md)
- [Run](docs/tutorial/run.md)

### Architecture

- [Backend Architecture](docs/architecture/backend.md)
- [Web Chat Architecture](docs/architecture/web-chat.md)

### Worker

- [API Gateway](docs/worker/api-gateway.md)
- [Segmentation Worker](docs/worker/segmentation-worker.md)
- [Reasoning Worker](docs/worker/reasoning-worker.md)

### Model

- [Standard Model](docs/model/standard-model.md)
- [SSL Model](docs/model/ssl-model.md)

## Thành viên nhóm
- [Đỗ Văn Tiến](https://github.com/catashiro31)
- [Trương Văn Hoàng](https://github.com/trhoaq)
- [Bùi Tuấn Anh]()
- [Nguyễn Đức Vũ]()

## Lời cảm ơn
- Xin cảm ơn cô [Nguyễn Thu Hường]() đã hướng dẫn trong quá trình thực hiện.
- Dự án sử dụng bộ dữ liệu FloodNet. Xin cảm ơn nhóm tác giả đã công bố dữ liệu.
