import os
import tempfile
import psycopg2
from psycopg2.extras import RealDictCursor
import cloudinary
import cloudinary.uploader
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

# Cloudinary Config
cloudinary.config(
    cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
    api_key=os.getenv("CLOUDINARY_API_KEY"),
    api_secret=os.getenv("CLOUDINARY_API_SECRET"),
    secure=True
)

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

def upload_image_to_bucket(image_name: str, image_content: Any, bucket_name: str = None):
    """
    Uploads base64 image content to Cloudinary.
    image_content can be a base64 string or bytes.
    """
    temp_path = None
    try:
        # Prepare content
        if isinstance(image_content, str):
            image_bytes = convert_base64_2_bytes(image_content)
        else:
            image_bytes = image_content

        with tempfile.NamedTemporaryFile(delete=False, suffix=".png") as tmpfile:
            tmpfile.write(image_bytes)
            temp_path = tmpfile.name

        # Upload to Cloudinary
        upload_result = cloudinary.uploader.upload(
            temp_path,
            public_id=image_name.split('.')[0],
            folder="floodai/masks",
            resource_type="image",
            overwrite=True
        )

        return upload_result.get("secure_url")

    except Exception as e:
        print(f"❌ Failed to upload to Cloudinary: {e}")
        return None
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass
