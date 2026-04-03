# 🚀 Hướng dẫn Chạy Học bán giám sát (SSL) cho FloodWiz

Thư mục `semi-supervised-learning/` chứa toàn bộ mã nguồn cần thiết để huấn luyện mô hình theo cơ chế **Global-Local Consistency**.

## 📁 1. Tổ chức Thư mục Dữ liệu (Bắt buộc)

Để kịch bản tự động nhận diện dữ liệu, bạn cần tạo thêm thư mục `unlabeled` trong bộ dữ liệu gốc như sau:

```text
FloodNet-Supervised_v1.0/
├── train/
│   ├── train-org-img/
│   └── train-label-img/
├── val/
│   ├── val-org-img/
│   └── val-label-img/
├── test/
│   └── ...
└── unlabeled/  <-- THƯ MỤC MỚI
    └── unlabeled-org-img/  <-- Chứa toàn bộ ảnh .jpg, .png chưa gán nhãn
```

> [!TIP]
> Bạn có thể lấy toàn bộ ảnh từ thư mục `test` gốc để bỏ vào `unlabeled-org-img` nhằm tận dụng tối đa dữ liệu có sẵn.

## ⚙️ 2. Cấu hình Quan trọng (`config_ssl.py`)

*   **`SSL_RATIO = 2`**: Trong mỗi batch, mô hình sẽ lấy 2 ảnh không nhãn cho mỗi 1 ảnh có nhãn. Bạn có thể tăng lên `3` hoặc `4` nếu có nhiều dữ liệu không nhãn.
*   **`CONSISTENCY_WEIGHT = 1.0`**: Trọng số cân bằng giữa nhãn thật và sự nhất quán.
*   **`SAVE_PRED_DIR = "ssl_predictions"`**: Thư mục lưu các bản đồ dự đoán để bạn kiểm tra kết quả bằng mắt.

## 🚀 3. Cách chạy Huấn luyện

Chạy lệnh sau từ thư mục gốc của dự án:

```bash
python semi-supervised-learning/train_ssl.py
```

## 📊 4. Đánh giá Hiệu quả

*   **Log Console**: Trong quá trình chạy, bạn sẽ thấy cột `Cons` biểu thị mức độ "không khớp" giữa bối cảnh toàn cục và chi tiết cục bộ. Giá trị này càng giảm, mô hình càng hiểu sâu về cấu trúc của vùng ngập lụt.
*   **Prediction Maps**: Sau mỗi 5 epoch (mặc định), mô hình sẽ lưu 5 tấm ảnh dự đoán mẫu vào thư mục `ssl_predictions/`. Bạn có thể mở các ảnh này để so sánh sự thay đổi của mask qua từng giai đoạn huấn luyện.

---
> [!NOTE]
> Mã nguồn đã được tối ưu hóa để đọc ảnh trực tiếp từ SSD (On-the-fly), giúp giảm yêu cầu RAM xuống dưới 16GB, thuận tiện cho việc chạy song song nhiều mô hình.
