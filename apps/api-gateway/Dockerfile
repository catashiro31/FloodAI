# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Cài đặt dependencies
RUN npm install

# Copy toàn bộ source code
COPY . .

# Build ứng dụng sang JavaScript
RUN npm run build

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

# Chỉ copy những file cần thiết từ stage builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

# Tạo thư mục uploads nếu chưa có (thường sẽ được mount volume)
RUN mkdir -p uploads/masks

EXPOSE 5000

# Chạy ở chế độ production
CMD ["npm", "run", "start:prod"]
