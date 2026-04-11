from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict

from dotenv import load_dotenv
import requests
from huggingface_hub import hf_hub_download, snapshot_download

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.append(str(REPO_ROOT))

from utils.segmentation.db_handler import (
    MASK_BUCKET_NAME,
    TABLE_NAME,
    get_data,
    update_data,
    upload_image_to_bucket,
)

load_dotenv()

important_class = list(range(1, 10))
job_status: Dict[str, dict] = {}

# load model form huggingface
# hf_repo = os.getenv("HUGGINGFACE_REPO", "Hoangphii/flood-segmentation-ssl")
# hf_model_filename = os.getenv("HUGGINGFACE_MODEL_FILENAME", "best_ssl_model.pth")

# def get_model(repo_id: str, filename: str) -> str | None:
#     try:
#         return hf_hub_download(repo_id=repo_id, filename=filename)
#     except Exception as exc:
#         print(f"hf_hub_download failed for {repo_id}/{filename}: {exc}")

#     try:
#         snapshot_dir = snapshot_download(repo_id=repo_id, allow_patterns="*.pth")
#         exact_path = os.path.join(snapshot_dir, filename)
#         if os.path.exists(exact_path):
#             return exact_path

#         pth_files: list[str] = []
#         for root, _dirs, files in os.walk(snapshot_dir):
#             for file_name in files:
#                 if file_name.endswith(".pth"):
#                     pth_files.append(os.path.join(root, file_name))
#         if pth_files:
#             return sorted(pth_files)[0]
#     except Exception as exc:
#         print(f"snapshot_download failed for {repo_id}: {exc}")

#     return None

def load_model():
    import torch
    from services.segmentation_worker.inference import Config, ComprehensiveVisualizer

    # model_weight = get_model(hf_repo, hf_model_filename)
    model_weight = "best_ssl_model.pth"
    if not model_weight:
        print("No model weight available from Hugging Face.")
        return None

    device = "cuda" if torch.cuda.is_available() else "cpu"
    try:
        predictor = ComprehensiveVisualizer(model_weight, Config, device)
        return predictor
    except Exception as exc:
        print(f"Can't load segmentation model: {exc}")
        return None


def send_segmentation_callback(callback_url: str, payload: dict) -> None:
    if not callback_url:
        return
    try:
        response = requests.post(callback_url, json=payload, timeout=15)
        response.raise_for_status()
    except Exception as exc:
        print(f"Failed to send segmentation callback: {exc}")


def run_segmentation_task(
    predictor: Any,
    session_id: str,
    callback_url: str = "",
    progress_url: str = "",
):
    temp_path = None

    def on_progress(percent, est_remaining):
        if not progress_url:
            return
        try:
            requests.post(
                progress_url,
                json={
                    "session_id": session_id,
                    "status": "processing_segmentation",
                    "progress": percent,
                    "est_seconds_remaining": est_remaining,
                },
                timeout=2,
            )
        except Exception:
            pass

    try:
        job_status[session_id] = {
            "session_id": session_id,
            "status": "processing_segmentation",
            "start_time": time.time(),
        }
        update_data("status", "processing_segmentation", TABLE_NAME, "session_id", session_id)

        data = get_data(session_id)
        if not data:
            error_message = "session_id not found in database"
            job_status[session_id].update({"status": "error", "error": error_message})
            update_data("status", "error", TABLE_NAME, "session_id", session_id)
            update_data("error_code", "SEGMENTATION_JOB_NOT_FOUND", TABLE_NAME, "session_id", session_id)
            update_data("error_message", error_message, TABLE_NAME, "session_id", session_id)
            send_segmentation_callback(
                callback_url,
                {
                    "session_id": session_id,
                    "status": "error",
                    "error_code": "SEGMENTATION_JOB_NOT_FOUND",
                    "error_message": error_message,
                },
            )
            return None

        image_source = data[0].get("image_url") or data[0].get("url_image")
        if not image_source:
            error_message = "Image URL not found for this session_id"
            job_status[session_id].update({"status": "error", "error": error_message})
            update_data("status", "error", TABLE_NAME, "session_id", session_id)
            update_data("error_code", "SEGMENTATION_IMAGE_URL_MISSING", TABLE_NAME, "session_id", session_id)
            update_data("error_message", error_message, TABLE_NAME, "session_id", session_id)
            send_segmentation_callback(
                callback_url,
                {
                    "session_id": session_id,
                    "status": "error",
                    "error_code": "SEGMENTATION_IMAGE_URL_MISSING",
                    "error_message": error_message,
                },
            )
            return None

        response = requests.get(image_source, timeout=30)
        if response.status_code != 200:
            error_message = f"Failed to download image from {image_source}"
            job_status[session_id].update({"status": "error", "error": error_message})
            update_data("status", "error", TABLE_NAME, "session_id", session_id)
            update_data("error_code", "SEGMENTATION_IMAGE_DOWNLOAD_FAILED", TABLE_NAME, "session_id", session_id)
            update_data("error_message", error_message, TABLE_NAME, "session_id", session_id)
            send_segmentation_callback(
                callback_url,
                {
                    "session_id": session_id,
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
        mask = result.get("mask", "")
        metrics = result.get("metrics", {})
        if not mask:
            error_message = "Segmentation output missing mask"
            job_status[session_id].update({"status": "error", "error": error_message})
            update_data("status", "error", TABLE_NAME, "session_id", session_id)
            update_data("error_code", "SEGMENTATION_MASK_MISSING", TABLE_NAME, "session_id", session_id)
            update_data("error_message", error_message, TABLE_NAME, "session_id", session_id)
            send_segmentation_callback(
                callback_url,
                {
                    "session_id": session_id,
                    "status": "error",
                    "error_code": "SEGMENTATION_MASK_MISSING",
                    "error_message": error_message,
                },
            )
            return None

        mask_filename = f"{session_id}_mask.png"
        mask_url = upload_image_to_bucket(mask_filename, mask, MASK_BUCKET_NAME)
        if not mask_url:
            error_message = "Failed to upload segmentation mask to storage"
            job_status[session_id].update({"status": "error", "error": error_message})
            update_data("status", "error", TABLE_NAME, "session_id", session_id)
            update_data("error_code", "SEGMENTATION_MASK_UPLOAD_FAILED", TABLE_NAME, "session_id", session_id)
            update_data("error_message", error_message, TABLE_NAME, "session_id", session_id)
            send_segmentation_callback(
                callback_url,
                {
                    "session_id": session_id,
                    "status": "error",
                    "error_code": "SEGMENTATION_MASK_UPLOAD_FAILED",
                    "error_message": error_message,
                },
            )
            return None

        update_data("mask_url", mask_url, TABLE_NAME, "session_id", session_id)
        update_data("status", "success_segmentation", TABLE_NAME, "session_id", session_id)
        update_data("error_code", None, TABLE_NAME, "session_id", session_id)
        update_data("error_message", None, TABLE_NAME, "session_id", session_id)
        update_data("metrics", json.dumps(metrics), TABLE_NAME, "session_id", session_id)

        end_time = time.time()
        job_status[session_id].update(
            {
                "session_id": session_id,
                "status": "success_segmentation",
                "mask_url": mask_url,
                "metrics": metrics,
                "end_time": end_time,
                "duration": end_time - job_status[session_id]["start_time"],
            }
        )
        send_segmentation_callback(callback_url, job_status[session_id])
        return mask_url
    
    except Exception as exc:
        if session_id not in job_status:
            job_status[session_id] = {"session_id": session_id}
        job_status[session_id].update({"status": "error", "error": str(exc)})
        update_data("status", "error", TABLE_NAME, "session_id", session_id)
        update_data("error_code", "SEGMENTATION_INTERNAL_ERROR", TABLE_NAME, "session_id", session_id)
        update_data("error_message", str(exc), TABLE_NAME, "session_id", session_id)
        send_segmentation_callback(
            callback_url,
            {
                "session_id": session_id,
                "status": "error",
                "error_code": "SEGMENTATION_INTERNAL_ERROR",
                "error_message": str(exc),
            },
        )
        return None
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass
