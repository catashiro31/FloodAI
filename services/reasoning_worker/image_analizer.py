from typing import Any

import cv2
import numpy as np

try:
    from FloodAI.services.reasoning_worker.file_handler import load_rgb_image
except Exception:
    from .file_handler import load_rgb_image


def analyze_flood_mask(image_source: str) -> dict[str, Any]:
    image_rgb = load_rgb_image(image_source)

    if image_rgb.ndim != 3 or image_rgb.shape[2] != 3:
        raise ValueError("Anh mask phai co 3 kenh RGB.")

    height, width, _ = image_rgb.shape
    total_pixels = int(height * width)

    lower_red = np.array([150, 0, 0], dtype=np.uint8)
    upper_red = np.array([255, 120, 120], dtype=np.uint8)
    lower_blue = np.array([0, 0, 150], dtype=np.uint8)
    upper_blue = np.array([120, 120, 255], dtype=np.uint8)
    lower_purple = np.array([100, 40, 100], dtype=np.uint8)
    upper_purple = np.array([160, 100, 160], dtype=np.uint8)

    house_mask = cv2.inRange(image_rgb, lower_red, upper_red)
    road_mask = cv2.bitwise_or(
        cv2.inRange(image_rgb, lower_blue, upper_blue),
        cv2.inRange(image_rgb, lower_purple, upper_purple),
    )

    house_pixels = int(cv2.countNonZero(house_mask))
    road_pixels = int(cv2.countNonZero(road_mask))
    active_pixels = house_pixels + road_pixels

    flooded_road_pct = round((road_pixels / total_pixels) * 100, 2)
    flooded_house_pct = round((house_pixels / total_pixels) * 100, 2)
    active_mask_pct = round((active_pixels / total_pixels) * 100, 2)

    ratio = None
    if house_pixels > 0:
        ratio = round(road_pixels / house_pixels, 3)

    return {
        "image_width": int(width),
        "image_height": int(height),
        "total_pixels": total_pixels,
        "active_mask_pixels": active_pixels,
        "active_mask_coverage_pct": active_mask_pct,
        "labeled_flood_pixels": active_pixels,
        "labeled_flood_coverage_pct": active_mask_pct,
        "flooded_road_pct_of_image": flooded_road_pct,
        "flooded_house_pct_of_image": flooded_house_pct,
        "road_to_house_ratio": ratio,
        "classes": {
            "flooded_road": {"pixels": road_pixels, "percentage": flooded_road_pct},
            "flooded_house": {"pixels": house_pixels, "percentage": flooded_house_pct},
        },
        "interpretation_notes": [
            "Percentages represent pixel-area coverage in the image, not real-world area or water depth.",
            "If segmentation does not cover all roads/buildings, these metrics should be treated as partial evidence.",
        ],
    }
