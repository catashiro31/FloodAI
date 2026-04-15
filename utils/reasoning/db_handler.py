from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Optional

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

REASONING_ENV_PATH = (
    Path(__file__).resolve().parents[2] / "services" / "reasoning_worker" / ".env"
)
load_dotenv(REASONING_ENV_PATH)

TABLE_NAME = os.getenv("SUPABASE_TABLE_NAME", "task_reasoning")
STATUS_COLUMN = os.getenv("STATUS_COLUMN", "status")
VLM_OUTPUT_COLUMN = os.getenv("VLM_OUTPUT_COLUMN", "vlm_analysis")
SESSION_TABLE = os.getenv("SESSION_TABLE_NAME", "sessions")
SESSION_HISTORY_TABLE = os.getenv("SESSION_HISTORY_TABLE_NAME", "session_history")
TASK_IMAGE_TABLE = os.getenv("TASK_IMAGE_TABLE_NAME", "task_image")
MASK_SOURCE_COLUMNS = [
    os.getenv("MASK_SOURCE_COLUMN", "mask_all_overlay"),
    "mask_all_overlay",
    "mask_Road-Flooded_overlay",
    "mask_Building-Flooded_overlay",
    "mask_url",
]

DATABASE_URL = os.getenv("DATABASE_URL")


def _get_conn():
    return psycopg2.connect(DATABASE_URL)


def get_data(job_id: str) -> list[dict[str, Any]]:
    if not DATABASE_URL:
        return []
    try:
        with _get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(f"SELECT * FROM {TABLE_NAME} WHERE job_id = %s", (job_id,))
                return [dict(row) for row in cur.fetchall()]
    except Exception as exc:
        print(f"get_data failed: {exc}")
        return []


def get_image_data_by_session(session_id: str) -> list[dict[str, Any]]:
    if not DATABASE_URL:
        return []
    try:
        with _get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    f"SELECT * FROM {TASK_IMAGE_TABLE} WHERE session_id = %s "
                    f"ORDER BY updated_at DESC LIMIT 1",
                    (session_id,),
                )
                return [dict(row) for row in cur.fetchall()]
    except Exception as exc:
        print(f"get_image_data_by_session failed: {exc}")
        return []


def _extract_last_history_values(history: Any) -> tuple[Optional[str], Optional[str]]:
    if not isinstance(history, list):
        return None, None

    last_question: Optional[str] = None
    last_reply: Optional[str] = None
    for entry in history:
        if not isinstance(entry, dict):
            continue

        role = entry.get("role")
        content = entry.get("content")
        if not isinstance(content, str) or not content.strip():
            continue

        if role == "user":
            last_question = content
        elif role == "assistant":
            last_reply = content

    return last_question, last_reply


def upsert_session(session_id: str, job_id: str, context: Any, history: Any) -> None:
    if not DATABASE_URL:
        return

    try:
        last_question, last_reply = _extract_last_history_values(history)
        ctx = context if isinstance(context, dict) else {}
        with _get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""INSERT INTO {SESSION_TABLE} (session_id, context, last_question, last_reply)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (session_id) DO UPDATE SET
                          context = EXCLUDED.context,
                          last_question = EXCLUDED.last_question,
                          last_reply = EXCLUDED.last_reply,
                          updated_at = now()""",
                    (session_id, json.dumps(ctx), last_question, last_reply),
                )

                if isinstance(history, list) and history:
                    cur.execute(
                        f"DELETE FROM {SESSION_HISTORY_TABLE} WHERE session_id = %s",
                        (session_id,),
                    )
                    for entry in history:
                        role = entry.get("role")
                        content = (entry.get("content") or "").strip()
                        if role in ("user", "assistant") and content:
                            cur.execute(
                                f"""INSERT INTO {SESSION_HISTORY_TABLE}
                                    (session_id, reasoning_task_id, role, content, image_urls)
                                    VALUES (%s, %s, %s, %s, %s)""",
                                (session_id, job_id, role, content, json.dumps([])),
                            )
            conn.commit()
        print(f"Session {session_id} upserted successfully.")
    except Exception as exc:
        print(f"Error upserting session {session_id}: {exc}")


def update_data(col: str, value: Any, table_name: str, query_col: str, query_value: str) -> None:
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
        print(f"Updated {col} for {query_col}={query_value}")
    except Exception as exc:
        print(f"DB update error for {query_col}={query_value}: {exc}")
