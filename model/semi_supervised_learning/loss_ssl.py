import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision.ops as ops
import sys
import os

current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.abspath(os.path.join(current_dir, '..', '..'))
if project_root not in sys.path:
    sys.path.append(project_root)

from model.loss import JointLoss

class SSLConsistencyLoss(nn.Module):
    """
    Tính toán sự sai khác giữa dự đoán Toàn cục (Global) và dự đoán Cục bộ (Local)
    """
    def __init__(self):
        super().__init__()
        
    def forward(self, local_logits, global_logits, bboxes, global_size_hw):
        # 1. Trích xuất (Crop) vùng tương ứng trên bản đồ Global
        # global_logits kích thước [B, C, H_g, W_g]
        # bboxes kích thước [B, 4] (x1, y1, x2, y2)
        
        box_list = [bboxes[i].unsqueeze(0) for i in range(len(bboxes))]
        scale = global_logits.shape[2] / global_size_hw[0]
        
        # Cắt lấy phần dự đoán của nhánh Global tại tọa độ của Patch Local
        global_ref = ops.roi_align(
            global_logits, 
            box_list, 
            output_size=local_logits.shape[2:], 
            spatial_scale=scale, 
            aligned=True
        )

        # 2. Tính toán sự nhất quán giữa 2 nhánh
        # Sử dụng KL Divergence trên phân phối xác suất Softmax
        p_local = F.softmax(local_logits, dim=1)
        p_global = F.softmax(global_ref, dim=1)
        
        # Hàm mất mát nhất quán (MSE hoặc KL)
        # Ở đây dùng MSE cho sự ổn định khi bắt đầu huấn luyện
        loss_cons = F.mse_loss(p_local, p_global)
        
        return loss_cons

class SSLJointLoss(nn.Module):
    def __init__(self, num_classes):
        super().__init__()
        self.sup_loss = JointLoss(num_classes)
        self.cons_loss = SSLConsistencyLoss()
        
    def forward(self, outputs, target=None, bboxes=None, global_size_hw=None, is_labeled=True):
        if is_labeled:
            # 1. Mất mát giám sát (Supervised Loss)
            # Tính cho nhánh Fusion (Main)
            loss_main = self.sup_loss(outputs, target)
            
            # --- TÍNH TOÁN BỔ SUNG CHO GLOBAL HEAD TRÊN NHÃN ---
            # Chúng ta cũng muốn nhánh Global học được từ nhãn thật 
            # để làm "người thầy" tốt cho nhánh Local.
            global_logits = outputs["global"]
            box_list = [bboxes[i].unsqueeze(0) for i in range(len(bboxes))]
            scale = global_logits.shape[2] / global_size_hw[0]
            
            # Cắt lấy vùng tương ứng trên Global Logits để khớp với Target của Local
            global_ref = ops.roi_align(
                global_logits, 
                box_list, 
                output_size=target.shape[1:], 
                spatial_scale=scale, 
                aligned=True
            )
            
            # Tính Supervised Loss cho nhánh Global
            loss_global_sup = self.sup_loss.compute_single_loss(global_ref, target)
            
            return loss_main + 0.5 * loss_global_sup
        else:
            # 2. Mất mát nhất quán (Unsupervised Consistency Loss)
            # So khớp giữa Global và Local trên ảnh không nhãn
            return self.cons_loss(outputs["main"], outputs["global"], bboxes, global_size_hw)
