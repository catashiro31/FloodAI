import os
import time
import torch
import tempfile
from typing import Dict
import requests

from inference import Config, ComprehensiveVisualizer
from file_handler import get_filename_from_url
from db_handler import TABLE_NAME, BUCKET_NAME, get_data, update_data, upload_image_to_bucket

MODEL_WEIGHT = "./best_heavy_hybrid_glnet.pth"
important_class = [1, 3]

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
):
    temp_path = None

    try:
        job_status[job_id] = {
            "status": "processing(segmentation)",
            "start_time": time.time(),
        }  
        update_data("status", "processing(segmentation)", TABLE_NAME, "job_id", job_id)

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

        response = requests.get(image_source, timeout=30)
        if response.status_code != 200:
            error_message = "Failed to download image"
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
        
        with tempfile.NamedTemporaryFile(delete=False, suffix=".png") as tmp:
            tmp.write(response.content)
            temp_path = tmp.name
        
        result = predictor.visualize_all(temp_path, important_class)
        overlay_content = result.get("mask_all_overlay")
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

        image_name = get_filename_from_url(image_source)
        image_name = f"{image_name}_mask_all_overlay.png"
        mask_all_overlay_url = upload_image_to_bucket(image_name, overlay_content, BUCKET_NAME)
        if not mask_all_overlay_url:
            error_message = "Failed to upload mask_all_overlay to storage"
            job_status[job_id].update({"status": "error", "error": error_message})
            update_data("status", "error", TABLE_NAME, "job_id", job_id)
            update_data("error_code", "SEGMENTATION_UPLOAD_FAILED", TABLE_NAME, "job_id", job_id)
            update_data("error_message", error_message, TABLE_NAME, "job_id", job_id)
            send_segmentation_callback(
                callback_url,
                {
                    "job_id": job_id,
                    "status": "error",
                    "error_code": "SEGMENTATION_UPLOAD_FAILED",
                    "error_message": error_message,
                },
            )
            return None

        update_data("mask_all_overlay", mask_all_overlay_url, TABLE_NAME, "job_id", job_id)
        update_data("status", "success(segmentation)", TABLE_NAME, "job_id", job_id)
        update_data("error_code", None, TABLE_NAME, "job_id", job_id)
        update_data("error_message", None, TABLE_NAME, "job_id", job_id)

        job_status[job_id].update({
            "status": "success(segmentation)",
            "mask_all_overlay": mask_all_overlay_url,
            "end_time": time.time(),
            "duration": time.time() - job_status[job_id]["start_time"]
        })
        send_segmentation_callback(
            callback_url,
            {
                "job_id": job_id,
                "status": "success(segmentation)",
                "mask_all_overlay": mask_all_overlay_url,
                "mask_url": mask_all_overlay_url,
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
