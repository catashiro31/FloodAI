FROM nginx:alpine

# Copy toàn bộ file tĩnh vào thư mục phục vụ của nginx
COPY . /usr/share/nginx/html

# Ghi đè cấu hình nginx mặc định bằng file cấu hình riêng
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
