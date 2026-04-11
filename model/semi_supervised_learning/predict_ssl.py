import os
import sys
import cv2
import numpy as np
import torch
import torch.nn.functional as F
import albumentations as A
from albumentations.pytorch import ToTensorV2
from tqdm import tqdm
import argparse

current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.abspath(os.path.join(current_dir, '..'))
if project_root not in sys.path:
    sys.path.append(project_root)

from FloodAI.model.semi_supervised_learning.config_ssl import SSLConfig
from FloodAI.model.semi_supervised_learning.model_ssl import FloodWizSSL

# Bảng màu hiển thị (RGB) chuẩn cho 10 lớp FloodNet
COLOR_MAP = {
    0: [0, 0, 0],           # Background
    1: [220, 20, 60],       # Building-flooded
    2: [197, 235, 19],      # Building-non-flooded
    3: [128, 64, 128],      # Road-flooded
    4: [105, 105, 105],     # Road-non-flooded
    5: [0, 191, 255],       # Water
    6: [34, 139, 34],       # Tree
    7: [255, 165, 0],       # Vehicle
    8: [0, 128, 128],       # Pool
    9: [124, 252, 0]        # Grass
}

def decode_segmentation_masks(mask, colormap, n_classes):
    r = np.zeros_like(mask).astype(np.uint8)
    g = np.zeros_like(mask).astype(np.uint8)
    b = np.zeros_like(mask).astype(np.uint8)
    for l in range(0, n_classes):
        idx = mask == l
        r[idx] = colormap[l][0]
        g[idx] = colormap[l][1]
        b[idx] = colormap[l][2]
    rgb = np.stack([r, g, b], axis=2)
    return rgb

def predict_single_image(img_path, model, config, transform, device):
    """
    Dự đoán mask cho một ảnh lớn sử dụng kỹ thuật Sliding Window.
    Hỗ trợ Padding đặc biệt nếu ảnh nhỏ hơn kích thước LOCAL_SIZE.
    """
    print(f"🔍 Đang dự đoán cho ảnh: {os.path.basename(img_path)}")
    orig_img = cv2.imread(img_path)
    if orig_img is None:
        raise ValueError(f"Không thể đọc ảnh từ: {img_path}")
        
    full_img_rgb = cv2.cvtColor(orig_img, cv2.COLOR_BGR2RGB)
    h_orig, w_orig = full_img_rgb.shape[:2]

    # === QUAN TRỌNG: PAD NẾU ẢNH NHỎ HƠN LOCAL SIZE ===
    # Sử dụng BORDER_REFLECT_101 để ảnh nhân bản êm ái ra viền, giúp mô hình không bị ngợp
    pad_h = max(0, config.LOCAL_SIZE - h_orig)
    pad_w = max(0, config.LOCAL_SIZE - w_orig)
    if pad_h > 0 or pad_w > 0:
        full_img_rgb = cv2.copyMakeBorder(full_img_rgb, 0, pad_h, 0, pad_w, cv2.BORDER_REFLECT_101)
        
    h_padded, w_padded = full_img_rgb.shape[:2]

    # Global Image Preparation (Dùng ảnh Padded)
    g_img_resized = cv2.resize(full_img_rgb, (config.GLOBAL_SIZE, config.GLOBAL_SIZE))
    g_tensor = transform(image=g_img_resized)['image'].unsqueeze(0).to(device)

    # Sliding window settings
    stride = config.LOCAL_SIZE // 2  # Overlap 50% để tránh lỗi viền
    local_size = config.LOCAL_SIZE

    # Khởi tạo bản đồ xác suất và đếm (Dùng kích thước Padded)
    prob_map = torch.zeros((config.NUM_CLASSES, h_padded, w_padded), dtype=torch.float32, device=device)
    count_map = torch.zeros((1, h_padded, w_padded), dtype=torch.float32, device=device)

    # Tạo danh sách các y, x tọa độ cho Sliding Window
    y_coords = list(range(0, h_padded, stride))
    x_coords = list(range(0, w_padded, stride))
    
    # Đảm bảo cắt đến tận mép phải và mép dưới cùng
    if y_coords[-1] + local_size < h_padded: y_coords.append(h_padded - local_size)
    if x_coords[-1] + local_size < w_padded: x_coords.append(w_padded - local_size)

    model.eval()
    with torch.no_grad():
        for y in tqdm(y_coords, desc="Sliding Window Rows"):
            for x in x_coords:
                y1 = max(0, min(y, h_padded - local_size))
                x1 = max(0, min(x, w_padded - local_size))
                y2 = min(h_padded, y1 + local_size)
                x2 = min(w_padded, x1 + local_size)
                
                # Cắt patch
                l_img_crop = full_img_rgb[y1:y2, x1:x2]
                
                # Biến đổi patch thành Tensor
                l_tensor = transform(image=l_img_crop)['image'].unsqueeze(0).to(device)
                
                # Tính Bbox Tensor
                scale_h, scale_w = config.GLOBAL_SIZE / h_padded, config.GLOBAL_SIZE / w_padded
                bbox_tensor = torch.tensor([
                    [x1 * scale_w, y1 * scale_h, x2 * scale_w, y2 * scale_h]
                ], dtype=torch.float32).to(device)

                with torch.amp.autocast('cuda', enabled=True):
                    outputs = model(g_tensor, l_tensor, bbox_tensor)
                    logits = outputs['main'] # Hình dạng: [1, NUM_CLASSES, local_size, local_size]
                    probs = F.softmax(logits, dim=1).squeeze(0) # [NUM_CLASSES, local_size, local_size]

                # Cộng dồn vào bản đồ lớn
                prob_map[:, y1:y2, x1:x2] += probs
                count_map[:, y1:y2, x1:x2] += 1.0

    # Lấy nhãn có xác suất cao nhất
    prob_map /= count_map
    final_mask_padded = torch.argmax(prob_map, dim=0).cpu().numpy().astype(np.uint8)
    
    # === CROP (XÉN) LẠI KÍCH THƯỚC CHUẨN CỦA ẢNH GỐC BAN ĐẦU ===
    final_mask = final_mask_padded[:h_orig, :w_orig]
    
    return orig_img, final_mask

def main():
    parser = argparse.ArgumentParser(description="Dự đoán ảnh bằng mô hình SSL FloodWiz")
    parser.add_argument('--input', type=str, required=True, help="Đường dẫn đến file ảnh hoặc thư mục ảnh")
    parser.add_argument('--output', type=str, default='ssl_results', help="Thư mục xuất kết quả")
    parser.add_argument('--weights', type=str, default='best_ssl_model.pth', help="File weights của mô hình (.pth)")
    parser.add_argument('--blend', action='store_true', help="Chồng màu dự đoán lên ảnh gốc để dễ nhìn")
    args = parser.parse_args()

    config = SSLConfig()
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"💻 Đang sử dụng thiết bị: {device}")

    # Chuẩn bị mô hình
    print(f"🏗️ Đang nạp mô hình FloodWizSSL với backbone: {config.BACKBONE}")
    model = FloodWizSSL(config.NUM_CLASSES, config.BACKBONE).to(device)
    
    if not os.path.exists(args.weights):
        raise FileNotFoundError(f"Không tìm thấy file tạ trọng: {args.weights}")
        
    model.load_state_dict(torch.load(args.weights, map_location=device, weights_only=True))
    model.eval()
    print("✅ Đã nạp weights thành công!")

    # Transform
    transform = A.Compose([
        A.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ToTensorV2()
    ])

    # Danh sách tập tin
    if os.path.isdir(args.input):
        files = glob.glob(os.path.join(args.input, '*.*'))
        files = [f for f in files if f.lower().endswith(('.png', '.jpg', '.jpeg'))]
    else:
        files = [args.input]

    os.makedirs(args.output, exist_ok=True)

    # Dự đoán
    for file_path in files:
        filename = os.path.basename(file_path)
        name, ext = os.path.splitext(filename)
        
        # Dự đoán
        orig_img, mask = predict_single_image(file_path, model, config, transform, device)
        
        # Tạo ảnh màu để hiển thị
        color_mask = decode_segmentation_masks(mask, COLOR_MAP, config.NUM_CLASSES)
        color_mask_bgr = cv2.cvtColor(color_mask, cv2.COLOR_RGB2BGR)

        # Lưu ảnh Mask
        mask_path = os.path.join(args.output, f"{name}_mask.png")
        cv2.imwrite(mask_path, color_mask_bgr)
        
        # Blend ảnh gốc và Mask
        if args.blend:
            blended = cv2.addWeighted(orig_img, 0.6, color_mask_bgr, 0.4, 0)
            blend_path = os.path.join(args.output, f"{name}_blend.jpg")
            cv2.imwrite(blend_path, blended)
            print(f"✅ Đã lưu kết quả tại: {blend_path}")
        else:
            print(f"✅ Đã lưu kết quả tại: {mask_path}")

    print("🎉 Hoàn tất quá trình dự đoán!")

if __name__ == '__main__':
    import glob
    main()
