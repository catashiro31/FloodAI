from model.attention import ChannelAttention, SpatialAttentionGate
import torch
import torch.nn as nn
import torchvision.ops as ops

class DeepFusionModule(nn.Module):

    def __init__(self, channels):
        super().__init__()
        
        self.ca_local = ChannelAttention(channels)
        self.ca_global = ChannelAttention(channels)
        
        self.spatial_gate = SpatialAttentionGate(channels * 2)
        
        self.project = nn.Sequential(
            nn.Conv2d(channels * 2, channels, 1, bias=False),
            nn.GroupNorm(32, channels), 
            nn.ReLU(inplace=True)
        )
        
    def forward(self, l_feat, g_feat, bboxes, global_size_hw):

        scale = g_feat.shape[2] / global_size_hw[0]
        
        box_list = [bboxes[i].unsqueeze(0) for i in range(len(bboxes))]
        

        g_crop = ops.roi_align(
            g_feat, 
            box_list, 
            output_size=l_feat.shape[2:], 
            spatial_scale=scale, 
            aligned=True
        )
        
        l_refined = self.ca_local(l_feat)
        g_refined = self.ca_global(g_crop)
        
        cat_feat = torch.cat([l_refined, g_refined], dim=1) 
        gate_map = self.spatial_gate(cat_feat)
        
        fused_feat = l_refined * gate_map + g_refined * (1.0 - gate_map)
        
        out = self.project(torch.cat([fused_feat, l_feat], dim=1))
        
        return out