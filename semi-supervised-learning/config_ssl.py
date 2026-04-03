import torch
import sys
import os

# Cho phép import từ thư mục cha
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from config import Config

class SSLConfig(Config):
    # Đường dẫn dữ liệu không nhãn
    UNLABELED_DATA_ROOT = os.path.join(Config.DATA_ROOT, 'unlabeled', 'unlabeled-org-img')
    
    # SSL Hyperparameters
    SSL_RATIO = 2  # Số lượng patch không nhãn trên 1 patch có nhãn
    CONSISTENCY_WEIGHT = 1.0  # Trọng số của Consistency Loss
    
    # Warmup cho Consistency Loss (tăng dần từ 0 lên 1)
    CONSISTENCY_RAMPUP_EPOCHS = 5
    
    # Lưu bản đồ dự đoán
    SAVE_PRED_DIR = "ssl_predictions"
    SAVE_FREQ_EPOCHS = 5
    
    # Ghi đè BATCH_SIZE nếu cần (vì SSL tốn VRAM hơn)
    BATCH_SIZE = 2 # Nếu dùng RTX 409x có thể tăng lên 4
    ACCUM_STEPS = 8 # Tăng tích lũy gradient để bù lại Batch Size nhỏ
