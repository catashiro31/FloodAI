from __future__ import annotations

import base64
import importlib
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[3]


def install_python_stubs() -> None:
    dotenv = types.ModuleType("dotenv")
    dotenv.load_dotenv = lambda *args, **kwargs: None
    sys.modules["dotenv"] = dotenv

    requests = types.ModuleType("requests")
    requests.calls = []

    class Response:
        def __init__(self, status_code=200, content=b""):
            self.status_code = status_code
            self.content = content

        def raise_for_status(self):
            if self.status_code >= 400:
                raise RuntimeError(f"http {self.status_code}")

    def post(url, json=None, timeout=None):
        requests.calls.append(("post", url, json, timeout))
        return Response(200)

    def get(url, timeout=None):
        requests.calls.append(("get", url, None, timeout))
        return Response(200, b"fake-image")

    requests.post = post
    requests.get = get
    sys.modules["requests"] = requests

    huggingface_hub = types.ModuleType("huggingface_hub")
    huggingface_hub.hf_hub_download = lambda *args, **kwargs: "weight.pth"
    huggingface_hub.snapshot_download = lambda *args, **kwargs: "snapshot"
    sys.modules["huggingface_hub"] = huggingface_hub

    db_handler = types.ModuleType("utils.segmentation.db_handler")
    db_handler.MASK_BUCKET_NAME = "masks"
    db_handler.TABLE_NAME = "task_image"
    db_handler.get_data = lambda _session_id: [{"image_url": "https://example.com/image.png"}]
    db_handler.update_data = lambda *args, **kwargs: None
    db_handler.upload_image_to_bucket = (
        lambda image_name, _mask, _bucket: f"https://cdn.example.com/{image_name}"
    )
    sys.modules["utils.segmentation.db_handler"] = db_handler


class ModelHandlerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        install_python_stubs()
        sys.path.insert(0, str(REPO_ROOT))

    def setUp(self):
        sys.modules.pop("services.segmentation_worker.model_handler", None)
        self.model_handler = importlib.import_module(
            "services.segmentation_worker.model_handler"
        )
        self.requests = sys.modules["requests"]
        self.requests.calls = []

    def test_run_segmentation_task_keeps_worker_callback_shape(self):
        encoded_mask = base64.b64encode(b"mask-bytes").decode("utf-8")
        callbacks = []
        db_updates = []

        class Predictor:
            def visualize_all(self, _temp_path, _classes, progress_callback=None):
                if progress_callback:
                    progress_callback(50, 3)
                return {"mask": encoded_mask, "metrics": {"flooded": True}}

        with patch.object(
            self.model_handler,
            "get_data",
            return_value=[{"image_url": "https://example.com/image.png"}],
        ), patch.object(
            self.model_handler,
            "update_data",
            side_effect=lambda *args: db_updates.append(args),
        ), patch.object(
            self.model_handler,
            "upload_image_to_bucket",
            return_value="https://cdn.example.com/session-123_mask.png",
        ), patch.object(
            self.model_handler,
            "send_segmentation_callback",
            side_effect=lambda url, payload: callbacks.append((url, payload)),
        ):
            result = self.model_handler.run_segmentation_task(
                Predictor(),
                "session-123",
                "https://gateway.example/webhook",
                "https://gateway.example/progress",
            )

        self.assertEqual(result, "https://cdn.example.com/session-123_mask.png")
        self.assertTrue(
            any(
                call[0] == "post"
                and call[1] == "https://gateway.example/progress"
                and call[2]["session_id"] == "session-123"
                for call in self.requests.calls
            )
        )
        self.assertTrue(
            any(update[0] == "mask_url" and update[1] == "https://cdn.example.com/session-123_mask.png" for update in db_updates)
        )
        self.assertEqual(callbacks[-1][0], "https://gateway.example/webhook")
        self.assertEqual(callbacks[-1][1]["status"], "success_segmentation")
        self.assertEqual(callbacks[-1][1]["session_id"], "session-123")
        self.assertEqual(
            callbacks[-1][1]["mask_url"],
            "https://cdn.example.com/session-123_mask.png",
        )
        self.assertEqual(callbacks[-1][1]["metrics"], {"flooded": True})


if __name__ == "__main__":
    unittest.main()
