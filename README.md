#  🌊 FloodWiz:A Comprehensive Semantic Segmentation Pipeline for UAV Flood Imagery
---
## 🚀 Giới thiệu
Trong bối cảnh biến đổi khí hậu toàn cầu đang làm gia tăng tần suất và mức độ tàn phá của các trận **lũ lụt**, việc ứng dụng công nghệ viễn thám thông qua **thiết bị bay không người lái** (UAV) đã trở thành một giải pháp then chốt để **giám sát** và **đánh giá thiệt hại** nhanh chóng. Mặc dù cung cấp nguồn dữ liệu hình ảnh có **độ phân giải siêu cao** (VHR), việc tự động trích xuất chính xác phạm vi ngập lụt vẫn vấp phải những thách thức lớn về **sự mất cân bằng** lớp dữ liệu, **tính tương đồng phổ** giữa các đối tượng và sự khó khăn trong việc **dung hòa** giữa **ngữ cảnh toàn cục** với các **chi tiết cục bộ**. Để giải quyết triệt để những rào cản này, nghiên cứu của chúng tôi giới thiệu **FloodWiz** – một mô hình phân đoạn ngữ nghĩa tiên tiến được thiết kế chuyên biệt cho dữ liệu thảm họa. Bằng cách tích hợp kiến trúc **mạng Siamese** nhánh đôi **Global-Local** với bộ trích xuất **ConvNeXt**, kết hợp cùng **cơ chế chú ý lai** (Hybrid Attention) tại tầng dung hợp và bộ giải mã **UperNet**, FloodWiz không chỉ tự động lọc nhiễu hiệu quả mà còn tái tạo **xuất sắc** các ranh giới ngập lụt phức tạp, thiết lập một tiêu chuẩn mới về độ chính xác và tính ứng dụng thực tiễn trên tập dữ liệu **FloodNet**.
## ⚙️ Thiết lập huấn luyện
### 1. Yêu cầu phần cứng và phần mềm
* **Hệ điều hành:** Linux hoặc Windows `10/11`
* **Python:** Phiên bản `3.12.12`.
* **GPU:** 
    * Khuyến nghị dùng: `RTX 3090` hoặc tương đương. 
    * Yêu cầu: Tối thiểu `16GB` dung lượng VRAM.
* **RAM:** Tối thiểu `105GB` để xử lý dữ liệu VHR.
* **Ổ cứng:** Ít nhất `16GB` để lưu trữ dữ liệu.
### 2. Chuẩn bị dữ liệu
Dự án này sử dụng tập dữ liệu **FloodNet-Supervised_v1.0**. Bạn vui lòng tải toàn bộ tập dữ liệu gốc từ liên kết dưới đây:

📥 **[Tải tập dữ liệu FloodNet tại đây (Dropbox)](https://www.dropbox.com/scl/fo/k33qdif15ns2qv2jdxvhx/ABRgeEe0sFTRcv4YAhXY848/FloodNet-Supervised_v1.0?dl=0&rlkey=ao2493wzl1cltonowjdbrnp7f&subfolder_nav_tracking=1)**

Sau khi tải về, hãy giải nén và đặt thư mục `FloodNet-Supervised_v1.0` nằm cùng cấp với các tệp mã nguồn dự án. Cấu trúc thư mục dữ liệu bắt buộc phải tuân theo định dạng sau:
```
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
### 3. Cài đặt thư viện
**Thư viện cần thiết** đã được liệt kê trong tệp `requirements.txt`. Dùng lệnh sau để cài đặt tất cả:
```
pip install -r requirements.txt
```
### 4. Huấn luyện mô hình
**Pipeline huấn luyện** được triển khai trong tệp `train.py`. Để bắt đầu huấn luyện, chạy lệnh sau:
```
python train.py
```
### 5. Ngoài ra
Thư mục `others/` chứa các tệp mã nguồn bổ sung, bao gồm `deeplabv3plus.py`, `unetplusplus.py`, `pspnet.py` và `segformerb4.py` – một số mô hình phân đoạn ngữ nghĩa chuẩn được sử dụng để so sánh với **FloodWiz**. Chỉ cần chạy các tệp này để huấn luyện `python [file]`.
## 📊 Đánh giá và dự đoán mẫu
### 1. Đánh giá mô hình
Sau khi huấn luyện, mô hình sẽ được đánh giá trên tập dữ liệu kiểm tra. Kết quả đánh giá sẽ bao gồm các chỉ số như **IoU**, **F1-score** và **accuracy** cho từng lớp.
*Bảng đánh giá*
### 2. Dự đoán mẫu
*So sánh ảnh dự đoán với grountruth và ảnh thật*
