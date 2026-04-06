import os
from contextlib import asynccontextmanager
from uuid import UUID

import nest_asyncio
import uvicorn
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, HTTPException
from pydantic import BaseModel

from db_handler import STATUS_COLUMN, TABLE_NAME, get_data, supabase, update_data
from model_handler import (
    build_generation_config,
    job_status,
    load_model,
    run_reasoning_task,
)

load_dotenv()

port = int(os.getenv("PORT", "8000"))

pipe = None
generation_config = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global pipe, generation_config
    pipe = load_model()
    generation_config = build_generation_config()
    yield


app = FastAPI(title="FloodNet VLM API", lifespan=lifespan)


class ReasoningRequest(BaseModel):
    job_id: UUID
    session_id: str = ""
    question: str = ""
    callback_url: str = ""
    reset: bool = False


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "model_loaded": pipe is not None,
        "db_connected": supabase is not None,
    }


@app.get("/model_status")
async def model_status():
    processing_jobs = [
        job_id
        for job_id, status in job_status.items()
        if status.get("status") == "processing(vlm)"
    ]
    return {
        "model_loaded": pipe is not None,
        "total_jobs_in_memory": len(job_status),
        "processing_jobs": processing_jobs,
    }


@app.post("/reasoning")
async def reasoning(request: ReasoningRequest, background_tasks: BackgroundTasks):
    try:
        job_id = str(request.job_id)

        if pipe is None or generation_config is None:
            raise HTTPException(status_code=503, detail="Model not loaded")

        data = get_data(job_id)
        if not data:
            update_data(STATUS_COLUMN, "error", TABLE_NAME, "job_id", job_id)
            raise HTTPException(status_code=404, detail="job_id not found")

        row = data[0]
        db_session_id = row.get("session_id") or request.session_id or job_id

        if request.reset:
            from model_handler import conversation_store

            if db_session_id in conversation_store:
                conversation_store[db_session_id].clear()
                print(f"Cleared memory for session_id: {db_session_id}")

        current_state = job_status.get(job_id, {}).get("status")
        if current_state in {"queued", "processing(vlm)"}:
            return {"job_id": job_id, "status": "already_running"}

        image_url = row.get("image_url") or row.get("url_image")
        if not image_url:
            update_data(STATUS_COLUMN, "error", TABLE_NAME, "job_id", job_id)
            raise HTTPException(
                status_code=404,
                detail="Missing image_url for this job_id",
            )

        background_tasks.add_task(
            run_reasoning_task,
            pipe,
            generation_config,
            job_id,
            db_session_id,
            request.question,
            request.callback_url,
            False,
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
    except Exception as e:
        import traceback

        error_details = traceback.format_exc()
        print(error_details)
        raise HTTPException(status_code=500, detail=str(e))


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
        "answer": row.get("vlm_analysis"),
        "source": "database",
    }


if __name__ == "__main__":
    nest_asyncio.apply()
    uvicorn.run(app, host="0.0.0.0", port=port)
