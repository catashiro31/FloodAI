# Sử dụng image PyTorch có sẵn CUDA 12.1 để tối ưu hiệu suất GPU
FROM pytorch/pytorch:2.2.0-cuda12.1-cudnn8-runtime

WORKDIR /app

# Cài đặt các thư viện hệ thống cần thiết cho OpenCV và xử lý ảnh
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements và cài đặt dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy toàn bộ source code của worker
COPY . .

# Tạo thư mục tạm và log (thường sẽ được mount volume)
RUN mkdir -p /app/temp

# Port mặc định cho worker
EXPOSE 8080

# Chạy FastAPI application
CMD ["python", "api.py"]
