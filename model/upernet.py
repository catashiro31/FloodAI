from model.fusion import DeepFusionModule
import torch.nn as nn
import torch.nn.functional as F
import torch

class UperNetHead(nn.Module):
    def __init__(self, in_channels_list, num_classes, pool_scales=(1, 2, 3, 6)):
        super().__init__()
        self.in_channels_list = in_channels_list
        fpn_inplanes = 512
        
        self.ppm_pooling = []
        self.ppm_convs = []
        for scale in pool_scales:
            self.ppm_pooling.append(nn.AdaptiveAvgPool2d(scale))
            
            self.ppm_convs.append(nn.Sequential(
                nn.Conv2d(in_channels_list[-1], 512, 1, bias=False),
                nn.GroupNorm(32, 512),
                nn.ReLU(inplace=True)
            ))
        self.ppm_pooling = nn.ModuleList(self.ppm_pooling)
        self.ppm_convs = nn.ModuleList(self.ppm_convs)
        
        self.ppm_last_conv = nn.Sequential(
            nn.Conv2d(in_channels_list[-1] + len(pool_scales) * 512, fpn_inplanes, 3, padding=1, bias=False),
            nn.GroupNorm(32, fpn_inplanes),
            nn.ReLU(inplace=True)
        )
        
        self.fpn_in = nn.ModuleList()
        for ch in in_channels_list[:-1]:
            self.fpn_in.append(nn.Sequential(
                nn.Conv2d(ch, fpn_inplanes, 1, bias=False),
                nn.GroupNorm(32, fpn_inplanes),
                nn.ReLU(inplace=True)
            ))
            
        self.fpn_out = nn.ModuleList()
        for _ in range(len(in_channels_list) - 1):
                self.fpn_out.append(nn.Sequential(
                nn.Conv2d(fpn_inplanes, fpn_inplanes, 3, padding=1, bias=False),
                nn.GroupNorm(32, fpn_inplanes),
                nn.ReLU(inplace=True)
            ))
        
        self.fpn_bottleneck = nn.Sequential(
            nn.Conv2d(len(in_channels_list) * fpn_inplanes, fpn_inplanes, 3, padding=1, bias=False),
            nn.GroupNorm(32, fpn_inplanes),
            nn.ReLU(inplace=True)
        )
        
        self.dropout = nn.Dropout(0.1)
        self.conv_seg = nn.Conv2d(fpn_inplanes, num_classes, 1)

    def forward(self, features):

        x = features[-1]
        input_size = x.shape[2:]
        ppm_outs = [x]
        
        for pool, conv in zip(self.ppm_pooling, self.ppm_convs):
            ppm_outs.append(F.interpolate(conv(pool(x)), size=input_size, mode='bilinear', align_corners=True))
        
        ppm_out = self.ppm_last_conv(torch.cat(ppm_outs, dim=1))
        
        fpn_feature = ppm_out
        out_features = [fpn_feature]
        
        for i in range(len(features) - 2, -1, -1): 
            lateral = self.fpn_in[i](features[i])
            
            top_down = F.interpolate(fpn_feature, size=lateral.shape[2:], mode='bilinear', align_corners=True)
            
            fpn_feature = lateral + top_down
            
            out_features.append(self.fpn_out[i](fpn_feature))
            
        target_size = out_features[-1].shape[2:]
        fpn_outs = []
        
        for feat in out_features:
            if feat.shape[2:] != target_size:
                feat = F.interpolate(feat, size=target_size, mode='bilinear', align_corners=True)
            fpn_outs.append(feat)
            
        fpn_outs = torch.cat(fpn_outs, dim=1)
        fpn_outs = self.fpn_bottleneck(fpn_outs)
        
        output = self.conv_seg(self.dropout(fpn_outs))
        return output