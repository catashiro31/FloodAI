import os
from pathlib import Path
from typing import Any

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

from utils.segmentation.file_handler import convert_base64_2_bytes

SEGMENTATION_ENV_PATH = (
    Path(__file__).resolve().parents[2] / "services" / "segmentation_worker" / ".env"
)
load_dotenv(SEGMENTATION_ENV_PATH)

DATABASE_URL = os.getenv("DATABASE_URL")
UPLOADS_DIR = os.getenv("UPLOADS_DIR", str(Path(__file__).resolve().parents[2] / "uploads"))
GATEWAY_BASE_URL = os.getenv("GATEWAY_BASE_URL", "http://localhost:5000")
TABLE_NAME = os.getenv("SUPABASE_TABLE_NAME", "task_image")
MASK_BUCKET_NAME = os.getenv("SUPABASE_MASK_BUCKET_NAME", "masks")


def _get_conn():
    return psycopg2.connect(DATABASE_URL)


def get_data(session_id: str):
    if not DATABASE_URL:
        return []
    try:
        with _get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    f"SELECT image_url FROM {TABLE_NAME} WHERE session_id = %s",
                    (session_id,),
                )
                return [dict(row) for row in cur.fetchall()]
    except Exception as exc:
        print(f"Database get_data failed: {exc}")
        return []


def update_data(col: str, value: Any, table_name: str, query_col: str, query_value: str):
    if not DATABASE_URL:
        return
    try:
        with _get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE {table_name} SET {col} = %s WHERE {query_col} = %s",
                    (value, query_value),
                )
            conn.commit()
        print(f"Updated {col} for {query_col}: {query_value}")
    except Exception as exc:
        print(f"Database update failed: {exc}")


def upload_image_to_bucket(image_name: str, image_content: str, bucket_name: str):
    save_dir = Path(UPLOADS_DIR) / bucket_name
    save_dir.mkdir(parents=True, exist_ok=True)
    file_path = save_dir / image_name

    try:
        file_path.write_bytes(convert_base64_2_bytes(image_content))
        url = f"{GATEWAY_BASE_URL}/uploads/{bucket_name}/{image_name}"
        print(f"Saved mask to {file_path}, public URL: {url}")
        return url
    except Exception as exc:
        print(f"Failed to save file locally: {exc}")
        return None
