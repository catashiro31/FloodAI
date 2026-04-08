import os
import tempfile
import psycopg2
from psycopg2.extras import RealDictCursor
from typing import Any, Optional
from dotenv import load_dotenv

from file_handler import convert_base64_2_bytes

load_dotenv()

# Database Config
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "31102006")
DB_NAME = os.getenv("DB_NAME", "floodai")
TABLE_NAME = "tasks"

# Database Config

def get_db_connection():
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASSWORD,
        dbname=DB_NAME
    )

def get_data(job_id: str):
    try:
        conn = get_db_connection()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(f"SELECT image_url FROM {TABLE_NAME} WHERE job_id = %s", (job_id,))
            result = cur.fetchone()
            return [result] if result else []
    except Exception as e:
        print(f"❌ Lỗi khi truy vấn database: {e}")
        return []
    finally:
        if 'conn' in locals():
            conn.close()
    
def update_data(col: str, value: Any, table_name: str, query_col: str, query_value: str):
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            query = f"UPDATE {table_name} SET {col} = %s, updated_at = NOW() WHERE {query_col} = %s"
            cur.execute(query, (value, query_value))
            conn.commit()
            if cur.rowcount > 0:
                print(f"✅ Đã cập nhật thành công cho {query_col}: {query_value}")
            else:
                print(f"⚠️ Không tìm thấy hàng nào ở {query_col} có : {query_value}")
    except Exception as e:
        print(f"❌ Lỗi khi cập nhật database: {e}")
    finally:
        if 'conn' in locals():
            conn.close()

