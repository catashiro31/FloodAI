# SSL Model

Thư mục nguồn: `model/semi_supervised_learning`

## Mục tiêu

Phiên bản học bán giám sát cho FloodWiz, tận dụng thêm ảnh không gán nhãn.

## Thành phần chính

- `config_ssl.py`
- `dataloader_ssl.py`
- `loss_ssl.py`
- `model_ssl.py`
- `train_ssl.py`
- `predict_ssl.py`

## Cấu trúc dữ liệu bổ sung

Ngoài dữ liệu supervised chuẩn, SSL cần thêm:

```text
FloodNet-Supervised_v1.0/
└── unlabeled/
    └── unlabeled-org-img/
```

## Cấu hình mặc định đáng chú ý

Theo `config_ssl.py`:

- `SSL_RATIO = 2`
- `CONSISTENCY_WEIGHT = 1.0`
- `CONSISTENCY_RAMPUP_EPOCHS = 5`
- `SAVE_PRED_DIR = ssl_predictions`
- `SAVE_FREQ_EPOCHS = 5`
- `BATCH_SIZE = 2`
- `ACCUM_STEPS = 8`

## Huấn luyện

```bash
cd model
python semi_supervised_learning/train_ssl.py
```

## Theo dõi kết quả

- log console có giá trị consistency
- prediction maps được lưu vào `ssl_predictions`
- có thể dùng `predict_ssl.py` để xuất dự đoán từ checkpoint SSL
