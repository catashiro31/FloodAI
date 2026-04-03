import torch
import torch.nn as nn
import torch.nn.functional as F
import sys
import os

# Import từ thư mục cha
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from model import HeavyGLNet
from upernet import UperNetHead

class FloodWizSSL(HeavyGLNet):
    def __init__(self, num_classes, backbone_name, drop_path_rate=0.2):
        super().__init__(num_classes, backbone_name, drop_path_rate)
        
        # Bổ sung một bộ giải mã nhỏ cho nhánh Global
        # Giúp mô hình có khả năng dự đoán từ cái nhìn toàn cảnh
        channels = self.backbone.feature_info.channels()
        
        self.global_decoder = nn.Sequential(
            nn.Conv2d(channels[-1], 256, 3, padding=1, bias=False),
            nn.BatchNorm2d(256),
            nn.ReLU(inplace=True),
            nn.Conv2d(256, num_classes, 1)
        )

    def forward(self, g_img, l_img, bboxes):
        # Nhánh backbone
        g_feats = self.backbone(g_img)
        l_feats = self.backbone(l_img)
        
        # Nhánh Fusion (giống model gốc)
        l_feats_fused = [l_feats[0]]
        for i, fuser in enumerate(self.fusers):
            idx = i + 1
            fused = fuser(l_feats[idx], g_feats[idx], bboxes, (g_img.shape[2], g_img.shape[3]))
            l_feats_fused.append(fused)
        
        main_logits = self.decoder(l_feats_fused)
        main_logits = F.interpolate(main_logits, size=l_img.shape[2:], mode='bilinear', align_corners=True)
        
        # Nhánh Global Dự đoán (phục vụ SSL)
        global_logits = self.global_decoder(g_feats[-1])
        global_logits = F.interpolate(global_logits, size=g_img.shape[2:], mode='bilinear', align_corners=True)
        
        ret = {
            "main": main_logits,   # Dự đoán cục bộ (đã fusion)
            "global": global_logits # Dự đoán toàn cục
        }
        
        if self.training:
            aux_logits = self.aux_local(l_feats[-1])
            aux_logits = F.interpolate(aux_logits, size=l_img.shape[2:], mode='bilinear', align_corners=True)
            ret["aux"] = aux_logits
            
        return ret
