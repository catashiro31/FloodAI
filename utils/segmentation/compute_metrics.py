import cv2
import numpy as np

# Minimum vehicle blob area to filter single-pixel noise
_MIN_VEHICLE_AREA_PX = 10

# Match visualization threshold for consistency
_MASK_THRESHOLD = 0.5


def _get_binary_mask(probs, class_idx: int, h_img: int, w_img: int) -> np.ndarray:
    prob_map = probs[class_idx]
    binary = (prob_map > _MASK_THRESHOLD).astype(np.uint8)
    if binary.shape != (h_img, w_img):
        binary = cv2.resize(binary, (w_img, h_img), interpolation=cv2.INTER_NEAREST)
    return binary


def _count_all_components(mask: np.ndarray) -> int:
    """Count all connected components with no area filter."""
    num_labels, _ = cv2.connectedComponents(mask, connectivity=8)
    return max(0, num_labels - 1)


def _flood_severity(flood_pct: float, road_ratio: float) -> str:
    if flood_pct < 5:
        return "none"
    if flood_pct < 15 and road_ratio < 20:
        return "low"
    if flood_pct < 35 or road_ratio < 50:
        return "moderate"
    if flood_pct < 60:
        return "severe"
    return "critical"


def compute_metrics(probs, config, h_img, w_img, threshold=_MASK_THRESHOLD):
    """
    Tinh toan cac thong so phan tich lu lut tu xac suat phan doan.

    Classes: [0:Background, 1:Building-Flooded, 2:Building-Non-Flooded,
              3:Road-Flooded, 4:Road-Non-Flooded, 5:Water,
              6:Tree, 7:Vehicle, 8:Pool, 9:Grass]
    """
    def get_mask(class_idx):
        return _get_binary_mask(probs, class_idx, h_img, w_img)

    mask_building_flooded = get_mask(1)
    mask_building_nonflooded = get_mask(2)
    mask_road_flooded = get_mask(3)
    mask_road_nonflooded = get_mask(4)
    mask_water = get_mask(5)
    mask_tree = get_mask(6)
    mask_vehicle = get_mask(7)

    total_pixels = h_img * w_img

    # --- Flood coverage ---
    flood_pixels = (
        int(np.sum(mask_road_flooded))
        + int(np.sum(mask_building_flooded))
        + int(np.sum(mask_water))
    )
    flood_ratio_total = flood_pixels / total_pixels if total_pixels > 0 else 0.0
    flood_pct = round(flood_ratio_total * 100, 2)
    is_flooded = flood_pct >= 5.0

    # --- Water-only coverage ---
    water_pct = round(int(np.sum(mask_water)) / total_pixels * 100, 2) if total_pixels > 0 else 0.0

    # --- Road flood ratio: flooded road / (flooded + non-flooded) ---
    road_flooded_px = int(np.sum(mask_road_flooded))
    road_nonflooded_px = int(np.sum(mask_road_nonflooded))
    road_total_px = road_flooded_px + road_nonflooded_px
    road_flood_pct = round(road_flooded_px / road_total_px * 100, 2) if road_total_px > 0 else 0.0

    # --- Building counting without min-area filter ---
    close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    mask_bf_clean = cv2.morphologyEx(mask_building_flooded, cv2.MORPH_CLOSE, close_kernel)
    mask_bnf_clean = cv2.morphologyEx(mask_building_nonflooded, cv2.MORPH_CLOSE, close_kernel)

    num_building_flooded = _count_all_components(mask_bf_clean)
    num_building_nonflooded = _count_all_components(mask_bnf_clean)
    building_total = num_building_flooded + num_building_nonflooded
    building_flood_ratio = (
        round(num_building_flooded / building_total * 100, 2) if building_total > 0 else 0.0
    )

    # --- Vehicles: per-vehicle 7x7 dilation to check flood proximity ---
    flood_danger_mask = cv2.bitwise_or(mask_road_flooded, mask_water)
    neighbor_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    num_vehicle_labels, vehicle_labels, vehicle_stats, _ = cv2.connectedComponentsWithStats(
        mask_vehicle, connectivity=8
    )
    num_vehicle_on_flood = 0
    total_vehicles = 0
    for i in range(1, num_vehicle_labels):
        if vehicle_stats[i, cv2.CC_STAT_AREA] < _MIN_VEHICLE_AREA_PX:
            continue
        total_vehicles += 1
        single_mask = (vehicle_labels == i).astype(np.uint8)
        dilated = cv2.dilate(single_mask, neighbor_kernel)
        if np.any(cv2.bitwise_and(dilated, flood_danger_mask)):
            num_vehicle_on_flood += 1
    vehicle_safe_count = total_vehicles - num_vehicle_on_flood

    # --- Tree / vegetation coverage ---
    tree_pct = round(int(np.sum(mask_tree)) / total_pixels * 100, 2) if total_pixels > 0 else 0.0

    # --- Distinct flood zones (connected components of combined flood mask) ---
    combined_flood = cv2.bitwise_or(
        cv2.bitwise_or(mask_road_flooded, mask_building_flooded), mask_water
    )
    flood_zone_count = _count_all_components(combined_flood)

    # --- Extended metrics (on-request only) ---
    mask_pool = get_mask(8)

    road_accessibility_index = round(1.0 - road_flooded_px / road_total_px, 4) if road_total_px > 0 else 1.0

    building_px = int(np.sum(mask_building_flooded)) + int(np.sum(mask_building_nonflooded))
    road_px = road_flooded_px + road_nonflooded_px
    impervious_surface_pct = round((building_px + road_px) / total_pixels * 100, 2) if total_pixels > 0 else 0.0

    building_density = round(building_px / total_pixels * 100, 2) if total_pixels > 0 else 0.0

    pool_pct = round(int(np.sum(mask_pool)) / total_pixels * 100, 2) if total_pixels > 0 else 0.0

    num_flood_labels, _, flood_stats, _ = cv2.connectedComponentsWithStats(combined_flood, connectivity=8)
    largest_flood_zone_pct = 0.0
    if num_flood_labels > 1:
        areas = [flood_stats[i, cv2.CC_STAT_AREA] for i in range(1, num_flood_labels)]
        largest_flood_zone_pct = round(max(areas) / total_pixels * 100, 2) if total_pixels > 0 else 0.0

    severity = _flood_severity(flood_pct, road_flood_pct)

    primary_metrics = {
        "is_flooded": bool(is_flooded),
        "flood_severity": severity,
        "flood_coverage_percent": flood_pct,
        "water_coverage_percent": water_pct,
        "road_flood_ratio": road_flood_pct,
        "building_flooded_count": int(num_building_flooded),
        "building_total_count": int(building_total),
        "building_flood_ratio": building_flood_ratio,
        "vehicle_total_count": int(total_vehicles),
        "vehicle_on_flooded_road": int(num_vehicle_on_flood),
        "vehicle_safe_count": int(vehicle_safe_count),
        "flood_zone_count": int(flood_zone_count),
    }

    extended_metrics = {
        "tree_coverage_percent": tree_pct,
        "road_accessibility_index": road_accessibility_index,
        "impervious_surface_percent": impervious_surface_pct,
        "building_density_percent": building_density,
        "pool_coverage_percent": pool_pct,
        "largest_flood_zone_percent": largest_flood_zone_pct,
    }

    metrics = {**primary_metrics, "extended": extended_metrics}
    print(f"Computed metrics: {metrics}")
    return metrics
