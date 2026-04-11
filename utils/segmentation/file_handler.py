import base64
import os
from urllib.parse import unquote, urlparse


def convert_base64_2_bytes(base64_str: str):
    if base64_str.startswith("data:"):
        base64_str = base64_str.split(",", 1)[1]
    return base64.b64decode(base64_str)


def get_filename_from_url(url):
    path = urlparse(url).path
    filename = os.path.basename(path)
    name_without_ext = os.path.splitext(filename)[0]
    name = unquote(name_without_ext)
    return name
