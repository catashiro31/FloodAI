from __future__ import annotations

import os
from typing import Any, Optional

from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv()

TABLE_NAME = os.getenv("SUPABASE_TABLE_NAME", "tasks")
STATUS_COLUMN = os.getenv("STATUS_COLUMN", "status")
VLM_OUTPUT_COLUMN = os.getenv("VLM_OUTPUT_COLUMN", "vlm_analysis")
SESSION_TABLE = os.getenv("SESSION_TABLE_NAME", "sessions")
MASK_SOURCE_COLUMNS = [
    os.getenv("MASK_SOURCE_COLUMN", "mask_all_overlay"),
    "mask_all_overlay",
    "mask_Road-Flooded_overlay",
    "mask_Building-Flooded_overlay",
    "mask_url",
]

DB_URL = os.getenv("SUPABASE_URL")
DB_KEY = os.getenv("SUPABASE_KEY")

supabase: Optional[Client] = None
if DB_URL and DB_KEY:
    try:
        supabase = create_client(DB_URL, DB_KEY)
    except Exception as exc:
        print(f"Failed to create Supabase client: {exc}")


def get_data(job_id: str) -> list[dict[str, Any]]:
    if not supabase:
        return []
    response = supabase.table(TABLE_NAME).select("*").eq("job_id", job_id).execute()
    return response.data or []


def upsert_session(session_id: str, job_id: str, context: Any, history: Any) -> None:
    if not supabase:
        return

    try:
        payload = {
            "session_id": session_id,
            "job_id": job_id,
            "context": context,
            "history": history
        }
        supabase.table(SESSION_TABLE).upsert(payload).execute()
        print(f"Session {session_id} upserted successfully.")
    except Exception as exc:
        print(f"Error upserting session {session_id}: {exc}")


def update_data(col: str, value: Any, table_name: str, query_col: str, query_value: str) -> None:
    if not supabase:
        return

    try:
        payload = {col: value}
        response = supabase.table(table_name).update(payload).eq(query_col, query_value).execute()
        if response.data:
            print(f"Updated {col} for {query_col}={query_value}")
        else:
            print(f"No rows updated for {query_col}={query_value}")
    except Exception as exc:
        print(f"DB update error for {query_col}={query_value}: {exc}")

if __name__ == "__main__":
    data = get_data("b1702daa-adb0-4765-98d1-2eb1da78c75c")
    if data:
        row = list(data[0].keys())
        print(data[0].get("session_id"))
