import os
import base64
import tempfile
from typing import Any, Optional

from supabase import Client, create_client
from dotenv import load_dotenv

from file_handler import convert_base64_2_bytes

load_dotenv()

DB_URL = os.getenv("SUPABASE_URL")
DB_KEY = os.getenv("SUPABASE_KEY")
BUCKET_NAME = os.getenv("SUPABASE_BUCKET_NAME", "masks")
TABLE_NAME = os.getenv("SUPABASE_TABLE_NAME", "tasks")

supabase: Optional[Client] = None
if DB_URL and DB_KEY:
    supabase = create_client(DB_URL, DB_KEY)

def get_data(job_id: str):
    if not supabase:
        return []
    response = supabase.table(TABLE_NAME).select("image_url").eq("job_id", job_id).execute()
    return response.data or []
    
def update_data(col: str, value: Any, table_name: str, query_col: str, query_value: str):
    if not supabase:
        return
    try:
        data = {col : value}
        response = supabase.table(table_name).update(data).eq(query_col, query_value).execute()
        
        if len(response.data) > 0:
            print(f"✅ Đã cập nhật thành công cho {query_col}: {query_value}")
        else:
            print(f"⚠️ Không tìm thấy hàng nào ở {query_col} có : {query_value}")
    except Exception as e:
        print(f"❌ Lỗi khi cập nhật database: {e}")

def upload_image_to_bucket(image_name: str, image_content: base64, bucket_name: str):
    temp_path = None
    if not supabase:
        print("⚠️ Supabase credentials missing. Skipping upload.")
        return None
    
    with tempfile.NamedTemporaryFile(delete=False, suffix=".png") as tmpfile:
        tmpfile.write(convert_base64_2_bytes(image_content))
        temp_path = tmpfile.name

    try:
        with open(temp_path, "rb") as f:
            supabase.storage.from_(bucket_name).upload(
                path = image_name, 
                file = f, 
                file_options = {
                    "content-type": "image/png",
                    "upsert": "true",
                }
            )

            url = supabase.storage.from_(bucket_name).get_public_url(image_name)
            return url
    except Exception as e:
        print(f"❌ Failed to upload to Supabase: {e}")
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass
