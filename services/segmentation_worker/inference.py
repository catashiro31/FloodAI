import os
import sys
import random
import numpy as np
import cv2
import torch
import torch.nn.functional as F
import albumentations as A
from albumentations.pytorch import ToTensorV2
import base64
import time

# Cho phép import từ thư mục gốc để truy cập models
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))

from model.semi_supervised_learning.config_ssl import SSLConfig
from model.semi_supervised_learning.model_ssl import FloodWizSSL

class Config:
    SEED = 42
    DEVICE = 'cuda' if torch.cuda.is_available() else 'cpu'

def seed_everything(seed=Config.SEED):
    random.seed(seed)
    os.environ['PYTHONHASHSEED'] = str(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False

seed_everything()

def compute_metrics(probs, config, h_img, w_img, threshold=0.8):
    """
    Tính toán các thông số phân tích lũ lụt từ xác suất phân đoạn.
    
    Classes: [0:Background, 1:Building-Flooded, 2:Building-Non-Flooded, 
              3:Road-Flooded, 4:Road-Non-Flooded, 5:Water, 
              6:Tree, 7:Vehicle, 8:Pool, 9:Grass]
    """
    def get_binary_mask(class_idx):
        prob_map = probs[class_idx]
        binary = (prob_map > threshold).astype(np.uint8)
        if binary.shape != (h_img, w_img):
            binary = cv2.resize(binary, (w_img, h_img), interpolation=cv2.INTER_NEAREST)
        return binary

    # --- Tạo binary masks cho các class cần thiết ---
    mask_building_flooded = get_binary_mask(1)      
    mask_building_nonflooded = get_binary_mask(2)    
    mask_road_flooded = get_binary_mask(3)           
    mask_road_nonflooded = get_binary_mask(4)        
    mask_water = get_binary_mask(5)                  
    mask_vehicle = get_binary_mask(7)                

    # --- 1. Ảnh có bị ngập không? ---
    total_pixels = h_img * w_img
    flood_pixels = int(np.sum(mask_road_flooded)) + int(np.sum(mask_building_flooded)) + int(np.sum(mask_water))
    flood_ratio_total = flood_pixels / total_pixels if total_pixels > 0 else 0
    is_flooded = flood_ratio_total > 0.05  # >5% pixel ngập

    # --- 2. Tỷ lệ đường bị ngập ---
    road_flooded_px = int(np.sum(mask_road_flooded))
    road_total_px = road_flooded_px + int(np.sum(mask_road_nonflooded))
    road_flood_ratio = road_flooded_px / road_total_px if road_total_px > 0 else 0.0

    # --- 3. Đếm tòa nhà (Connected Components) ---
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    
    mask_bf_clean = cv2.morphologyEx(mask_building_flooded, cv2.MORPH_CLOSE, kernel)
    num_building_flooded, _ = cv2.connectedComponents(mask_bf_clean)
    num_building_flooded = max(0, num_building_flooded - 1) 

    mask_bnf_clean = cv2.morphologyEx(mask_building_nonflooded, cv2.MORPH_CLOSE, kernel)
    num_building_nonflooded, _ = cv2.connectedComponents(mask_bnf_clean)
    num_building_nonflooded = max(0, num_building_nonflooded - 1)

    building_total = num_building_flooded + num_building_nonflooded

    # --- 4. Đếm xe trên đường ngập ---
    vehicle_on_flood = cv2.bitwise_and(mask_vehicle, mask_road_flooded)
    vehicle_clean = cv2.morphologyEx(vehicle_on_flood, cv2.MORPH_CLOSE, kernel)
    num_vehicle_on_flood, _ = cv2.connectedComponents(vehicle_clean)
    num_vehicle_on_flood = max(0, num_vehicle_on_flood - 1)

    metrics = {
        "is_flooded": bool(is_flooded),
        "flood_coverage_percent": round(flood_ratio_total * 100, 2),
        "road_flood_ratio": round(road_flood_ratio * 100, 2),
        "building_flooded_count": int(num_building_flooded),
        "building_total_count": int(building_total),
        "vehicle_on_flooded_road": int(num_vehicle_on_flood),
    }
    print(f"📊 Computed metrics: {metrics}")
    return metrics


class ComprehensiveVisualizer:
    def __init__(self, model_path, _, device=None):
        self.config = SSLConfig()
        
        # Thiết lập thiết bị xử lý: nếu CPU-only sẽ dùng 'cpu', nếu có Nvidia GPU dùng 'cuda'.
        self.device = device if device else ('cuda' if torch.cuda.is_available() else 'cpu')
        
        print(f"🏗️ Đang nạp mô hình FloodWizSSL với backbone {self.config.BACKBONE} trên {self.device}")
        
        self.model = FloodWizSSL(self.config.NUM_CLASSES, self.config.BACKBONE).to(self.device)
        self.model.load_state_dict(torch.load(model_path, map_location=self.device, weights_only=True))
        self.model.eval()
        
        self.transform = A.Compose([
            A.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
            ToTensorV2()
        ])

    def visualize_all(self, img_path, segmentation_class: list, progress_callback=None):
        start = time.time()
        orig_img = cv2.imread(img_path)
        if orig_img is None:
            raise FileNotFoundError(f"❌ Không tìm thấy ảnh tại: {img_path}")
            
        full_img_rgb = cv2.cvtColor(orig_img, cv2.COLOR_BGR2RGB)
        h_orig, w_orig = full_img_rgb.shape[:2]

        # === PAD NẾU ẢNH NHỎ HƠN LOCAL SIZE ===
        pad_h = max(0, self.config.LOCAL_SIZE - h_orig)
        pad_w = max(0, self.config.LOCAL_SIZE - w_orig)
        if pad_h > 0 or pad_w > 0:
            full_img_rgb = cv2.copyMakeBorder(full_img_rgb, 0, pad_h, 0, pad_w, cv2.BORDER_REFLECT_101)
            
        h_padded, w_padded = full_img_rgb.shape[:2]

        # Ảnh global scale
        g_img_resized = cv2.resize(full_img_rgb, (self.config.GLOBAL_SIZE, self.config.GLOBAL_SIZE))
        g_tensor = self.transform(image=g_img_resized)['image'].unsqueeze(0).to(self.device)

        # Sliding window config
        stride = self.config.LOCAL_SIZE // 2  # Overlap 50%
        local_size = self.config.LOCAL_SIZE

        prob_map = torch.zeros((self.config.NUM_CLASSES, h_padded, w_padded), dtype=torch.float32, device=self.device)
        count_map = torch.zeros((1, h_padded, w_padded), dtype=torch.float32, device=self.device)

        y_coords = list(range(0, h_padded, stride))
        x_coords = list(range(0, w_padded, stride))
        if y_coords[-1] + local_size < h_padded: y_coords.append(h_padded - local_size)
        if x_coords[-1] + local_size < w_padded: x_coords.append(w_padded - local_size)

        total_tiles = len(y_coords) * len(x_coords)
        tiles_done = 0
        use_autocast = self.device != 'cpu'

        with torch.no_grad():
            for y in y_coords:
                for x in x_coords:
                    y1 = max(0, min(y, h_padded - local_size))
                    x1 = max(0, min(x, w_padded - local_size))
                    y2 = min(h_padded, y1 + local_size)
                    x2 = min(w_padded, x1 + local_size)
                    
                    l_img_crop = full_img_rgb[y1:y2, x1:x2]
                    l_tensor = self.transform(image=l_img_crop)['image'].unsqueeze(0).to(self.device)
                    
                    scale_h, scale_w = self.config.GLOBAL_SIZE / h_padded, self.config.GLOBAL_SIZE / w_padded
                    bbox_tensor = torch.tensor([
                        [x1 * scale_w, y1 * scale_h, x2 * scale_w, y2 * scale_h]
                    ], dtype=torch.float32).to(self.device)

                    if use_autocast:
                        with torch.amp.autocast('cuda', enabled=True):
                            outputs = self.model(g_tensor, l_tensor, bbox_tensor)
                            logits = outputs['main'] 
                            probs = F.softmax(logits, dim=1).squeeze(0)
                    else:
                        outputs = self.model(g_tensor, l_tensor, bbox_tensor)
                        logits = outputs['main'] 
                        probs = F.softmax(logits, dim=1).squeeze(0)

                    prob_map[:, y1:y2, x1:x2] += probs
                    count_map[:, y1:y2, x1:x2] += 1.0

                    tiles_done += 1
                    if progress_callback:
                        percent = int((tiles_done / total_tiles) * 100)
                        elapsed = time.time() - start
                        est_remaining = int((elapsed / tiles_done) * (total_tiles - tiles_done)) if tiles_done > 0 else 0
                        progress_callback(percent, est_remaining)

        prob_map /= count_map
        
        # CROP lại theo ảnh gốc
        prob_map_orig = prob_map[:, :h_orig, :w_orig].cpu().numpy()

        def ndarray_to_base64(img_array, image_format=".png"):
            if img_array.dtype != np.uint8:
                img_array = np.clip(img_array * 255.0, 0, 255).astype(np.uint8)
            if img_array.ndim == 3:
                img_array = cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR)
            success, encoded_img = cv2.imencode(image_format, img_array)
            if not success:
                raise ValueError("❌ Không thể encode ảnh sang base64")
            return base64.b64encode(encoded_img.tobytes()).decode("utf-8")

        result = {}
        focus_classes = segmentation_class 
        class_colors = {
          1: [255, 0, 0],      # đỏ - Building Flooded
          5: [0, 255, 0],      # xanh lá - Water
          3: [0, 0, 255],      # xanh dương - Road Flooded
          2: [255, 255, 0],    # vàng - Building Non-Flooded
        }
  
        # All-class overlay
        all_overlay_img = cv2.cvtColor(orig_img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0

        alpha = 0.8
        for c_idx in focus_classes:
            p_map = prob_map_orig[c_idx]
            binary_map = (p_map > 0.8).astype(np.uint8)
            
            color_rgb = np.array(class_colors.get(c_idx, [255,255,255]), dtype=np.uint8)
            color_float = color_rgb.astype(np.float32) / 255.0
            mask_bool = binary_map.astype(bool)
            all_overlay_img[mask_bool] = (
                (1 - alpha) * all_overlay_img[mask_bool] + alpha * color_float
            )

        result["mask_all_overlay"] = ndarray_to_base64(all_overlay_img, image_format=".png")

        # Tính metrics
        metrics = compute_metrics(prob_map_orig, self.config, h_orig, w_orig)
        result["metrics"] = metrics

        end = time.time()
        print(f"Tổng thời gian dự đoán: {end-start:.2f}s")
        return result