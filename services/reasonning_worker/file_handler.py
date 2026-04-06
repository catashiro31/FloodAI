import numpy as np
import requests
from PIL import Image
import io

def load_rgb_image(source: str) -> tuple[np.ndarray, str]:
    response = requests.get(source, timeout=30)
    response.raise_for_status()
    raw_img = Image.open(io.BytesIO(response.content)).convert("RGB")
    return np.array(raw_img).astype(np.uint8)