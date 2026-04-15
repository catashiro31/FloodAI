import sys, os
import timm
import torch.nn as nn
import torch.nn.functional as F

current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.abspath(os.path.join(current_dir, '..'))
if project_root not in sys.path:
    sys.path.append(project_root)

from model.fusion import DeepFusionModule
from model.upernet import UperNetHead

class HeavyGLNet(nn.Module):
    def __init__(self, num_classes, backbone_name, drop_path_rate=0.2):
        super().__init__()
        print(f"🏗️ Loading Backbone: {backbone_name}")
        
        self.backbone = timm.create_model(
            backbone_name, 
            pretrained=True, 
            features_only=True,
            drop_path_rate=drop_path_rate
        )
        
        self.backbone.set_grad_checkpointing(True) 
        
        channels = self.backbone.feature_info.channels()
        
        self.fusers = nn.ModuleList([
            DeepFusionModule(channels[1]),
            DeepFusionModule(channels[2]),
            DeepFusionModule(channels[3])
        ])
        
        self.decoder = UperNetHead(channels, num_classes)
        
        self.aux_local = self._make_aux(channels[-1], num_classes)

    def _make_aux(self, in_ch, out_ch):
        return nn.Sequential(
            nn.Conv2d(in_ch, 256, 3, padding=1, bias=False),
            nn.BatchNorm2d(256),
            nn.ReLU(inplace=True),
            nn.Dropout(0.1),
            nn.Conv2d(256, out_ch, 1)
        )

    def forward(self, g_img, l_img, bboxes):
        
        g_feats = self.backbone(g_img)
        l_feats = self.backbone(l_img)
        
        l_feats_fused = [l_feats[0]] 
        
        for i, fuser in enumerate(self.fusers):
            idx = i + 1
            
            fused = fuser(
                l_feats[idx], 
                g_feats[idx], 
                bboxes, 
                (g_img.shape[2], g_img.shape[3])
            )
            l_feats_fused.append(fused)
            
            
        logits = self.decoder(l_feats_fused)
        
        logits = F.interpolate(logits, size=l_img.shape[2:], mode='bilinear', align_corners=True)
        
        ret = {"main": logits}
        
        if self.training:
            aux_logits = self.aux_local(l_feats[-1])
            aux_logits = F.interpolate(aux_logits, size=l_img.shape[2:], mode='bilinear', align_corners=True)
            ret["aux"] = aux_logits
            
        return ret