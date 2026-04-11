from __future__ import annotations

import importlib
import sys
import types
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]


def install_api_stubs() -> None:
    dotenv = types.ModuleType("dotenv")
    dotenv.load_dotenv = lambda *args, **kwargs: None
    sys.modules["dotenv"] = dotenv

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

    db_handler = types.ModuleType("services.reasoning_worker.db_handler")
    db_handler.STATUS_COLUMN = "status"
    db_handler.TABLE_NAME = "task_reasoning"
    db_handler.VLM_OUTPUT_COLUMN = "vlm_analysis"
    db_handler.get_data = lambda _job_id: []
    db_handler.update_data = lambda *args, **kwargs: None
    db_handler.supabase = object()
    sys.modules["services.reasoning_worker.db_handler"] = db_handler

    model_handler = types.ModuleType("services.reasoning_worker.model_handler")
    model_handler.job_status = {}
    model_handler.load_model = lambda: object()
    model_handler.build_generation_config = lambda: {"num_predict": 32}
    model_handler.run_reasoning_task = object()
    sys.modules["services.reasoning_worker.model_handler"] = model_handler


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        install_api_stubs()
        sys.path.insert(0, str(REPO_ROOT))

    def setUp(self):
        sys.modules.pop("services.reasoning_worker.api", None)
        self.api = importlib.import_module("services.reasoning_worker.api")

    def test_health_reports_model_loaded(self):
        self.api.client = object()

        import asyncio

        result = asyncio.run(self.api.health_check())

        self.assertEqual(result["status"], "healthy")
        self.assertIn("model_loaded", result)

    def test_reasoning_returns_404_when_job_missing(self):
        self.api.client = object()
        self.api.generation_config = {"num_predict": 32}
        self.api.get_data = lambda _job_id: []
        request = types.SimpleNamespace(
            job_id="11111111-1111-1111-1111-111111111111",
            session_id="session-1",
            question="What is happening?",
            callback_url="",
            reset=False,
        )
        background_tasks = self.api.BackgroundTasks()

        import asyncio

        with self.assertRaises(self.api.HTTPException) as ctx:
            asyncio.run(self.api.reasoning(request, background_tasks))

        self.assertEqual(ctx.exception.status_code, 404)

    def test_status_reads_configured_output_column(self):
        original_column = self.api.VLM_OUTPUT_COLUMN
        self.api.VLM_OUTPUT_COLUMN = "custom_answer"
        self.api.get_data = lambda _job_id: [
            {"status": "success_vlm", "custom_answer": "done"}
        ]
        try:
            import asyncio

            result = asyncio.run(
                self.api.status("11111111-1111-1111-1111-111111111111")
            )
        finally:
            self.api.VLM_OUTPUT_COLUMN = original_column

        self.assertEqual(result["answer"], "done")


if __name__ == "__main__":
    unittest.main()
