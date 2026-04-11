import os
import tempfile
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from supabase import Client, create_client

from utils.segmentation.file_handler import convert_base64_2_bytes

SEGMENTATION_ENV_PATH = (
    Path(__file__).resolve().parents[2] / "services" / "segmentation_worker" / ".env"
)
load_dotenv(SEGMENTATION_ENV_PATH)

DB_URL = os.getenv("SUPABASE_URL")
DB_KEY = os.getenv("SUPABASE_KEY")
MASK_BUCKET_NAME = os.getenv("SUPABASE_MASK_BUCKET_NAME", "masks")
TABLE_NAME = os.getenv("SUPABASE_TABLE_NAME", "task_image")

supabase: Optional[Client] = None
if DB_URL and DB_KEY:
    supabase = create_client(DB_URL, DB_KEY)


def get_data(session_id: str):
    if not supabase:
        return []
    response = (
        supabase.table(TABLE_NAME)
        .select("image_url")
        .eq("session_id", session_id)
        .execute()
    )
    return response.data or []


def update_data(col: str, value: Any, table_name: str, query_col: str, query_value: str):
    if not supabase:
        return
    try:
        data = {col: value}
        response = supabase.table(table_name).update(data).eq(query_col, query_value).execute()

        rows = response.data or []
        if len(rows) > 0:
            print(f"Updated successfully for {query_col}: {query_value}")
        else:
            print(f"No row found for {query_col}: {query_value}")
    except Exception as exc:
        print(f"Database update failed: {exc}")


def upload_image_to_bucket(image_name: str, image_content: str, bucket_name: str):
    temp_path = None
    if not supabase:
        print("Supabase credentials missing. Skipping upload.")
        return None

    with tempfile.NamedTemporaryFile(delete=False, suffix=".png") as tmpfile:
        tmpfile.write(convert_base64_2_bytes(image_content))
        temp_path = tmpfile.name

    try:
        with open(temp_path, "rb") as file_obj:
            supabase.storage.from_(bucket_name).upload(
                path=image_name,
                file=file_obj,
                file_options={
                    "content-type": "image/png",
                    "upsert": "true",
                },
            )

            url = supabase.storage.from_(bucket_name).get_public_url(image_name)
            return url
    except Exception as exc:
        print(f"Failed to upload to Supabase: {exc}")
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass
