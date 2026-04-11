import os
from contextlib import asynccontextmanager
from uuid import UUID

import nest_asyncio
import uvicorn
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, HTTPException
from pydantic import BaseModel

from db_handler import TABLE_NAME, get_data, update_data
from model_handler import job_status, load_model, run_segmentation_task

load_dotenv()

try:
    import torch
    torch.set_num_threads(os.cpu_count() or 4)
except Exception:
    torch = None

port = int(os.getenv("PORT", "8080"))


predictor = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global predictor
    predictor = load_model()
    yield


app = FastAPI(title="FloodNet Segmentation API", lifespan=lifespan)


class InferenceRequest(BaseModel):
    session_id: UUID
    callback_url: str
    progress_url: str = ""


@app.get("/health")
async def health_check():
    return {"status": "healthy", "model_loaded": predictor is not None}


@app.post("/inference")
async def get_inference(request: InferenceRequest, background_tasks: BackgroundTasks):
    if predictor is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    session_id = str(request.session_id)

    current_state = job_status.get(session_id, {}).get("status")
    if current_state in {"queued", "processing_segmentation"}:
        return {"session_id": session_id, "status": "already_running"}

    data = get_data(session_id)
    if not data:
        update_data("status", "error", TABLE_NAME, "session_id", session_id)
        raise HTTPException(status_code=404, detail="session_id not found")

    image_source = data[0].get("image_url") or data[0].get("url_image")
    if not image_source:
        update_data("status", "error", TABLE_NAME, "session_id", session_id)
        raise HTTPException(status_code=404, detail="session_id not found or missing image_url")

    background_tasks.add_task(
        run_segmentation_task,
        predictor,
        session_id,
        request.callback_url,
        request.progress_url,
    )
    job_status[session_id] = {"status": "queued", "session_id": session_id}
    return {"session_id": session_id, "status": "queued"}


@app.get("/status/{session_id}")
async def get_status(session_id: UUID):
    session_id_str = str(session_id)
    if session_id_str not in job_status:
        raise HTTPException(status_code=404, detail="Session not found")
    return job_status[session_id_str]


if __name__ == "__main__":
    nest_asyncio.apply()
    reload_enabled = os.getenv("RELOAD", "").lower() in {"1", "true", "yes"}
    uvicorn.run("api:app", host="0.0.0.0", port=port, reload=reload_enabled)
