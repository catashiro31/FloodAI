import base64
import io
from typing import Any

import numpy as np
import requests
from PIL import Image


def load_rgb_image(source: str) -> np.ndarray[Any, Any]:
    response = requests.get(source, timeout=30)
    response.raise_for_status()
    raw_img = Image.open(io.BytesIO(response.content)).convert("RGB")
    return np.array(raw_img).astype(np.uint8)


def load_image_bytes(source: str) -> bytes:
    response = requests.get(source, timeout=30)
    response.raise_for_status()
    return response.content


def load_image_base64(source: str) -> str:
    return base64.b64encode(load_image_bytes(source)).decode("utf-8")


def encode_image_base64(source: str) -> str:
    return load_image_base64(source)
