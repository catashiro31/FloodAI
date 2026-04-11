from __future__ import annotations

import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import UUID

import nest_asyncio
import uvicorn
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, HTTPException
from pydantic import BaseModel

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.append(str(REPO_ROOT))

from utils.reasoning.db_handler import (
    STATUS_COLUMN,
    TABLE_NAME,
    VLM_OUTPUT_COLUMN,
    get_data,
    supabase,
    update_data,
)

from services.reasoning_worker.model_handler import (
    build_generation_config,
    job_status,
    load_model,
    run_reasoning_task,
)

load_dotenv(Path(__file__).with_name(".env"))

port = int(os.getenv("PORT", "8010"))
PROCESSING_VLM_STATUS = "processing_vlm"

client = None
generation_config = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global client, generation_config
    client = load_model()
    generation_config = build_generation_config()
    yield


app = FastAPI(title="FloodNet Ollama Reasoning API", lifespan=lifespan)


class ReasoningRequest(BaseModel):
    job_id: UUID
    session_id: str = ""
    question: str = ""
    callback_url: str = ""
    reset: bool = False


@app.get("/health")
async def health_check():
    healthy = client is not None and supabase is not None
    return {
        "status": "healthy" if healthy else "degraded",
        "model_loaded": client is not None,
        "db_connected": supabase is not None,
        "model": os.getenv("OLLAMA_MODEL", "gemma4:e2b-it-q4_K_M"),
        "ollama_base_url": os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
    }


@app.get("/model_status")
async def model_status():
    processing_jobs = [
        job_id
        for job_id, status in job_status.items()
        if status.get("status") == PROCESSING_VLM_STATUS
    ]
    return {
        "model_loaded": client is not None,
        "total_jobs_in_memory": len(job_status),
        "processing_jobs": processing_jobs,
        "model": os.getenv("OLLAMA_MODEL", "gemma4:e2b-it-q4_K_M"),
    }


@app.post("/reasoning")
async def reasoning(request: ReasoningRequest, background_tasks: BackgroundTasks):
    try:
        job_id = str(request.job_id)

        if client is None or generation_config is None:
            raise HTTPException(status_code=503, detail="Model not loaded")

        data = get_data(job_id)
        if not data:
            update_data(STATUS_COLUMN, "error", TABLE_NAME, "job_id", job_id)
            raise HTTPException(status_code=404, detail="job_id not found")

        row = data[0]
        db_session_id = str(row.get("session_id") or request.session_id or job_id)

        if request.reset:
            from services.reasoning_worker.model_handler import conversation_store

            if db_session_id in conversation_store:
                conversation_store[db_session_id].clear()

        current_state = job_status.get(job_id, {}).get("status")
        if current_state in {"queued", PROCESSING_VLM_STATUS}:
            return {"job_id": job_id, "status": "already_running"}

        image_url = row.get("image_url") or row.get("url_image")
        if not image_url:
            update_data(STATUS_COLUMN, "error", TABLE_NAME, "job_id", job_id)
            raise HTTPException(status_code=404, detail="Missing image_url for this job_id")

        background_tasks.add_task(
            run_reasoning_task,
            client,
            generation_config,
            job_id,
            db_session_id,
            request.question,
            request.callback_url,
        )

        logged_question = (request.question or "").strip() or "FIRST_TURN_PROMPT"
        job_status[job_id] = {
            "status": "queued",
            "session_id": db_session_id,
            "question": logged_question,
        }
        return {"job_id": job_id, "session_id": db_session_id, "status": "queued"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/status/{job_id}")
async def status(job_id: UUID):
    job_id_str = str(job_id)
    if job_id_str in job_status:
        return {"job_id": job_id_str, **job_status[job_id_str]}

    data = get_data(job_id_str)
    if not data:
        raise HTTPException(status_code=404, detail="Job not found")

    row = data[0]
    return {
        "job_id": job_id_str,
        "status": row.get(STATUS_COLUMN, "unknown"),
        "answer": row.get(VLM_OUTPUT_COLUMN),
        "source": "database",
    }


if __name__ == "__main__":
    nest_asyncio.apply()
    uvicorn.run("services.reasoning_worker.api:app", host="0.0.0.0", port=port)
