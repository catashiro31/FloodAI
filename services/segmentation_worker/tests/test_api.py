from __future__ import annotations

import importlib
import sys
import types
import unittest
from pathlib import Path


SERVICE_DIR = Path(__file__).resolve().parents[1]


def install_api_stubs() -> None:
    dotenv = types.ModuleType("dotenv")
    dotenv.load_dotenv = lambda *args, **kwargs: None
    sys.modules["dotenv"] = dotenv

    torch = types.ModuleType("torch")
    torch.set_num_threads = lambda *_args, **_kwargs: None
    sys.modules["torch"] = torch

    nest_asyncio = types.ModuleType("nest_asyncio")
    nest_asyncio.apply = lambda: None
    sys.modules["nest_asyncio"] = nest_asyncio

    uvicorn = types.ModuleType("uvicorn")
    uvicorn.run = lambda *args, **kwargs: None
    sys.modules["uvicorn"] = uvicorn

    pydantic = types.ModuleType("pydantic")

    class BaseModel:
        def __init__(self, **kwargs):
            for key, value in kwargs.items():
                setattr(self, key, value)

    pydantic.BaseModel = BaseModel
    sys.modules["pydantic"] = pydantic

    fastapi = types.ModuleType("fastapi")

    class HTTPException(Exception):
        def __init__(self, status_code, detail):
            super().__init__(detail)
            self.status_code = status_code
            self.detail = detail

    class BackgroundTasks:
        def __init__(self):
            self.tasks = []

        def add_task(self, fn, *args):
            self.tasks.append((fn, args))

    class FastAPI:
        def __init__(self, *args, **kwargs):
            self.args = args
            self.kwargs = kwargs

        def get(self, _path):
            return lambda fn: fn

        def post(self, _path):
            return lambda fn: fn

    fastapi.BackgroundTasks = BackgroundTasks
    fastapi.FastAPI = FastAPI
    fastapi.HTTPException = HTTPException
    sys.modules["fastapi"] = fastapi

    db_handler = types.ModuleType("db_handler")
    db_handler.TABLE_NAME = "task_image"
    db_handler.get_data = lambda _session_id: [
        {"image_url": "https://example.com/image.png"}
    ]
    db_handler.update_data = lambda *args, **kwargs: None
    sys.modules["db_handler"] = db_handler

    model_handler = types.ModuleType("model_handler")
    model_handler.job_status = {}
    model_handler.load_model = lambda: object()
    model_handler.run_segmentation_task = object()
    sys.modules["model_handler"] = model_handler


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        install_api_stubs()
        sys.path.insert(0, str(SERVICE_DIR))

    def setUp(self):
        sys.modules.pop("api", None)
        self.api = importlib.import_module("api")

    def test_inference_enqueues_progress_url_in_background_task(self):
        self.api.predictor = object()
        request = types.SimpleNamespace(
            session_id="11111111-1111-1111-1111-111111111111",
            callback_url="https://gateway.example/webhook",
            progress_url="https://gateway.example/progress",
        )
        background_tasks = self.api.BackgroundTasks()

        import asyncio

        result = asyncio.run(self.api.get_inference(request, background_tasks))

        self.assertEqual(result["status"], "queued")
        fn, args = background_tasks.tasks[0]
        self.assertIs(fn, self.api.run_segmentation_task)
        self.assertEqual(
            args[1:],
            (
                "11111111-1111-1111-1111-111111111111",
                "https://gateway.example/webhook",
                "https://gateway.example/progress",
            ),
        )

    def test_inference_returns_already_running_for_duplicate_jobs(self):
        self.api.predictor = object()
        self.api.job_status["11111111-1111-1111-1111-111111111111"] = {
            "status": "processing_segmentation"
        }
        request = types.SimpleNamespace(
            session_id="11111111-1111-1111-1111-111111111111",
            callback_url="https://gateway.example/webhook",
            progress_url="",
        )
        background_tasks = self.api.BackgroundTasks()

        import asyncio

        result = asyncio.run(self.api.get_inference(request, background_tasks))

        self.assertEqual(
            result,
            {
                "session_id": "11111111-1111-1111-1111-111111111111",
                "status": "already_running",
            },
        )
        self.assertEqual(background_tasks.tasks, [])


if __name__ == "__main__":
    unittest.main()
