import os
import time
import torch
import tempfile
from typing import Dict
import requests

from inference import Config, ComprehensiveVisualizer
from file_handler import get_filename_from_url
from db_handler import TABLE_NAME, get_data, update_data, upload_image_to_bucket

MODEL_WEIGHT = r"f:\Nghiên cứu khoa học\Segmentation\FloodAI\model\best_ssl_model.pth"
important_class = list(range(1, 10))

job_status: Dict[str, dict] = {}


def load_model():
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    try:
        predictor = ComprehensiveVisualizer(MODEL_WEIGHT, Config, device)
        return predictor
    except Exception as e:
        print(f"❌ Can't load model: {e}")
        return None

def send_segmentation_callback(callback_url: str, payload: dict) -> None:
    if not callback_url:
        return
    try:
        response = requests.post(callback_url, json=payload, timeout=15)
        response.raise_for_status()
    except Exception as exc:
        print(f"⚠️ Failed to send segmentation callback: {exc}")


def run_segmentation_task(
    predictor: ComprehensiveVisualizer,
    job_id: str,
    callback_url: str = "",
    progress_url: str = "",
):
    temp_path = None

    def on_progress(percent, est_remaining):
        if not progress_url:
            return
        try:
            # Gửi tiến độ cho Gateway
            requests.post(progress_url, json={
                "job_id": job_id,
                "status": "processing_segmentation",
                "progress": percent,
                "est_seconds_remaining": est_remaining
            }, timeout=2)
        except:
            pass

    try:
        job_status[job_id] = {
            "status": "processing_segmentation",
            "start_time": time.time(),
        }  
        update_data("status", "processing_segmentation", TABLE_NAME, "job_id", job_id)

        data = get_data(job_id)
        if not data:
            error_message = "job_id not found in database"
            job_status[job_id].update({"status": "error", "error": error_message})
            update_data("status", "error", TABLE_NAME, "job_id", job_id)
            update_data("error_code", "SEGMENTATION_JOB_NOT_FOUND", TABLE_NAME, "job_id", job_id)
            update_data("error_message", error_message, TABLE_NAME, "job_id", job_id)
            send_segmentation_callback(
                callback_url,
                {
                    "job_id": job_id,
                    "status": "error",
                    "error_code": "SEGMENTATION_JOB_NOT_FOUND",
                    "error_message": error_message,
                },
            )
            return None

        image_source = data[0].get("image_url") or data[0].get("url_image")
        if not image_source:
            error_message = "Image URL not found for this job_id"
            job_status[job_id].update({"status": "error", "error": error_message})
            update_data("status", "error", TABLE_NAME, "job_id", job_id)
            update_data("error_code", "SEGMENTATION_IMAGE_URL_MISSING", TABLE_NAME, "job_id", job_id)
            update_data("error_message", error_message, TABLE_NAME, "job_id", job_id)
            send_segmentation_callback(
                callback_url,
                {
                    "job_id": job_id,
                    "status": "error",
                    "error_code": "SEGMENTATION_IMAGE_URL_MISSING",
                    "error_message": error_message,
                },
            )
            return None

        # Tải ảnh: Nếu là đường dẫn cục bộ /static/... thì đọc trực tiếp từ disk
        image_content = None
        if image_source.startswith("/static/"):
            # Tìm đường dẫn tuyệt đối tới thư mục uploads của gateway
            base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            file_rel_path = image_source.replace("/static/", "").replace("/", os.sep)
            abs_path = os.path.join(base_dir, "apps", "api-gateway", "uploads", file_rel_path)
            
            if os.path.exists(abs_path):
                with open(abs_path, "rb") as f:
                    image_content = f.read()
                print(f"✅ Loaded original image from local disk: {abs_path}")
            else:
                print(f"⚠️ Local file not found: {abs_path}, falling back to request (might fail)")
        
        if image_content is None:
            # Fallback dùng requests (cho các ảnh online cũ hoặc nếu disk access thất bại)
            response = requests.get(image_source, timeout=30)
            if response.status_code != 200:
                error_message = f"Failed to download image from {image_source}"
                job_status[job_id].update({"status": "error", "error": error_message})
                update_data("status", "error", TABLE_NAME, "job_id", job_id)
                update_data("error_code", "SEGMENTATION_IMAGE_DOWNLOAD_FAILED", TABLE_NAME, "job_id", job_id)
                update_data("error_message", error_message, TABLE_NAME, "job_id", job_id)
                send_segmentation_callback(
                    callback_url,
                    {
                        "job_id": job_id,
                        "status": "error",
                        "error_code": "SEGMENTATION_IMAGE_DOWNLOAD_FAILED",
                        "error_message": error_message,
                    },
                )
                return None
            image_content = response.content
        
        with tempfile.NamedTemporaryFile(delete=False, suffix=".png") as tmp:
            tmp.write(image_content)
            temp_path = tmp.name
        
        result = predictor.visualize_all(temp_path, important_class, progress_callback=on_progress)
        overlay_content = result.get("mask_all_overlay")
        pure_content = result.get("mask_pure")
        metrics = result.get("metrics", {})
        if not overlay_content:
            error_message = "Segmentation output missing mask_all_overlay"
            job_status[job_id].update({"status": "error", "error": error_message})
            update_data("status", "error", TABLE_NAME, "job_id", job_id)
            update_data("error_code", "SEGMENTATION_MASK_MISSING", TABLE_NAME, "job_id", job_id)
            update_data("error_message", error_message, TABLE_NAME, "job_id", job_id)
            send_segmentation_callback(
                callback_url,
                {
                    "job_id": job_id,
                    "status": "error",
                    "error_code": "SEGMENTATION_MASK_MISSING",
                    "error_message": error_message,
                },
            )
            return None

        # Lưu mask cục bộ thay vì upload Cloudinary
        import base64 as b64mod
        masks_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "apps", "api-gateway", "uploads", "masks")
        os.makedirs(masks_dir, exist_ok=True)
        
        # Lưu mask overlay
        mask_filename = f"{job_id}_mask_all_overlay.png"
        mask_path = os.path.join(masks_dir, mask_filename)
        mask_bytes = b64mod.b64decode(overlay_content)
        with open(mask_path, "wb") as f:
            f.write(mask_bytes)
        mask_all_overlay_url = f"/static/masks/{mask_filename}"
        
        # Lưu mask pure
        pure_mask_url = ""
        if pure_content:
            pure_filename = f"{job_id}_mask_pure.png"
            pure_path = os.path.join(masks_dir, pure_filename)
            pure_bytes = b64mod.b64decode(pure_content)
            with open(pure_path, "wb") as f:
                f.write(pure_bytes)
            pure_mask_url = f"/static/masks/{pure_filename}"
            print(f"✅ Pure Mask saved locally: {pure_path}")

        print(f"✅ Mask saved locally: {mask_path}")

        update_data("mask_all_overlay", mask_all_overlay_url, TABLE_NAME, "job_id", job_id)
        update_data("status", "success_segmentation", TABLE_NAME, "job_id", job_id)
        update_data("error_code", None, TABLE_NAME, "job_id", job_id)
        update_data("error_message", None, TABLE_NAME, "job_id", job_id)

        # Lưu metrics dạng JSON vào DB
        import json
        update_data("metrics", json.dumps(metrics), TABLE_NAME, "job_id", job_id)

        job_status[job_id].update({
            "status": "success_segmentation",
            "mask_all_overlay": mask_all_overlay_url,
            "mask_pure": pure_mask_url,
            "metrics": metrics,
            "end_time": time.time(),
            "duration": time.time() - job_status[job_id]["start_time"]
        })
        send_segmentation_callback(
            callback_url,
            {
                "job_id": job_id,
                "status": "success_segmentation",
                "mask_all_overlay": mask_all_overlay_url,
                "mask_pure": pure_mask_url,
                "mask_url": mask_all_overlay_url,
                "metrics": metrics,
            },
        )


    except Exception as e:
        job_status[job_id].update({"status": "error", "error": str(e)})
        update_data("status", "error", TABLE_NAME, "job_id", job_id)
        update_data("error_code", "SEGMENTATION_INTERNAL_ERROR", TABLE_NAME, "job_id", job_id)
        update_data("error_message", str(e), TABLE_NAME, "job_id", job_id)
        send_segmentation_callback(
            callback_url,
            {
                "job_id": job_id,
                "status": "error",
                "error_code": "SEGMENTATION_INTERNAL_ERROR",
                "error_message": str(e),
            },
        )
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass
