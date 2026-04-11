# Standard Model

Thư mục nguồn: `model`

## Mục tiêu

Mô hình chính xử lý semantic segmentation cho ảnh UAV lũ lụt trên tập FloodNet.

## Thành phần chính

- `config.py`: cấu hình huấn luyện và dataset
- `model.py`: mô hình chính
- `attention.py`, `fusion.py`, `upernet.py`: các khối mạng
- `dataloader.py`: nạp dữ liệu có nhãn
- `loss.py`: hàm loss
- `train.py`: entrypoint huấn luyện

## Cấu hình mặc định đáng chú ý

Theo `config.py`:

- `NUM_CLASSES = 10`
- `BACKBONE = convnext_base`
- `GLOBAL_SIZE = 768`
- `LOCAL_SIZE = 768`
- `BATCH_SIZE = 4`
- `ACCUM_STEPS = 4`
- `EPOCHS = 40`
- `DATA_ROOT = FloodNet-Supervised_v1.0`

## Cấu trúc dữ liệu mong đợi

```text
FloodNet-Supervised_v1.0/
├── train/
│   ├── train-org-img/
│   └── train-label-img/
├── val/
│   ├── val-org-img/
│   └── val-label-img/
└── test/
    ├── test-org-img/
    └── test-label-img/
```

## Cài đặt

```bash
pip install -r requirements.model.txt
```

## Huấn luyện

```bash
python train.py
```

## Baseline models

Các mô hình so sánh nằm trong `model/others`:

- `deeplabv3plus.py`
- `unetplusplus.py`
- `pspnet.py`
- `segformerb4.py`
