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

port = int(os.getenv("PORT", "8080"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    global predictor
    predictor = load_model()
    yield


app = FastAPI(title="FloodNet Segmentation API", lifespan=lifespan)


class InferenceRequest(BaseModel):
    job_id: UUID
    callback_url: str


@app.get("/health")
async def health_check():
    return {"status": "healthy", "model_loaded": predictor is not None}


@app.post("/inference")
async def get_inference(request: InferenceRequest, background_tasks: BackgroundTasks):
    if predictor is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    job_id = str(request.job_id)

    current_state = job_status.get(job_id, {}).get("status")
    if current_state in {"queued", "processing(segmentation)"}:
        return {"job_id": job_id, "status": "already_running"}

    data = get_data(job_id)
    if not data:
        update_data("status", "error", TABLE_NAME, "job_id", job_id)
        raise HTTPException(status_code=404, detail="job_id not found")

    image_source = data[0].get("image_url") or data[0].get("url_image")
    if not image_source:
        update_data("status", "error", TABLE_NAME, "job_id", job_id)
        raise HTTPException(status_code=404, detail="job_id not found or missing image_url")

    background_tasks.add_task(
        run_segmentation_task,
        predictor,
        job_id,
        request.callback_url,
    )
    job_status[job_id] = {"status": "queued"}
    return {"job_id": job_id, "status": "queued"}


@app.get("/status/{job_id}")
async def get_status(job_id: UUID):
    job_id_str = str(job_id)
    if job_id_str not in job_status:
        raise HTTPException(status_code=404, detail="Job not found")
    return job_status[job_id_str]


if __name__ == "__main__":
    nest_asyncio.apply()
    uvicorn.run(app, host="0.0.0.0", port=port)
