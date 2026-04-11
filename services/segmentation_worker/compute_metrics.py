import os, sys

import numpy as np, cv2

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

    # --- 4. Đếm xe trên đường ngập/vùng nước (Nguy hiểm) ---
    # Trong Semantic Segmentation, các class không chồng lấn pixel.
    # Vì vậy ta kiểm tra xem đối tượng Xe có nằm trong hoặc tiếp giáp vùng ngập không.
    flood_danger_mask = cv2.bitwise_or(mask_road_flooded, mask_water)
    
    # Tìm các đối tượng xe riêng biệt
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(mask_vehicle)
    num_vehicle_on_flood = 0
    
    # Kernel giãn nở nhỏ để kiểm tra vùng lân cận (khoảng 7-10 pixel)
    neighbor_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    
    for i in range(1, num_labels):
        # Tạo mask cho duy nhất chiếc xe thứ i
        single_vehicle_mask = (labels == i).astype(np.uint8)
        
        # Giãn nở nhẹ chiếc xe để xem nó có chạm vào vùng nước không
        dilated_vehicle = cv2.dilate(single_vehicle_mask, neighbor_kernel)
        
        # Kiểm tra giao thoa giữa vùng giãn nở của xe và vùng nguy hiểm
        if np.any(cv2.bitwise_and(dilated_vehicle, flood_danger_mask)):
            num_vehicle_on_flood += 1

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