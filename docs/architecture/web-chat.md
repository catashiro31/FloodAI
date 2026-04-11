# Web Chat Architecture

## Tổng quan

`apps/web-chat` là frontend tĩnh dùng:

- `index.html`
- `style.css`
- `script.js`

Không có bước build riêng. UI giao tiếp với gateway qua HTTP và Socket.IO.

## Tính năng chính

- tạo session mới
- upload ảnh đầu phiên
- hiển thị bubble chat user/assistant
- hiển thị attachment ảnh trong bubble user
- hiển thị metrics panel ở panel phải
- gallery so sánh ảnh gốc và mask bằng slider
- hydrate lại lịch sử, metrics và gallery khi mở session cũ

## State chính trong `script.js`

- `sessionId`
- `currentJobId`
- `analysisMessages`
- `sessionHasImage`
- `sessionReadyForChat`
- `currentMetrics`
- `isProcessing`

## HTTP endpoints frontend sử dụng

- `POST /chat/upload`
- `GET /chat/sessions`
- `GET /chat/sessions/:sessionId`
- `GET /chat/tasks/:sessionId`

## Socket events frontend sử dụng

- `registerSession`
- `sendMessage`
- `uploadStatus`
- `receiveMessage`

## UI sections

### Assessment view

- khung upload/gate cho session mới
- chat history
- composer follow-up
- ảnh session hiện tại
- metrics panel

### Gallery view

- danh sách task có mask
- slider so sánh ảnh gốc và mask
- badge metrics rút gọn

## Hành vi quan trọng

- session mới bắt buộc có ảnh trước khi chat
- follow-up chỉ mở khi session đã có mask và hoàn tất pipeline
- frontend có chống stale realtime bằng `jobId`
- frontend có chống race khi đổi session/gallery liên tục
- text render được escape trước khi đưa vào `innerHTML`
