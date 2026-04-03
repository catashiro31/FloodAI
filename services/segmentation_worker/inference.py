import os
import random
import numpy as np
import cv2
import torch
import torch.nn as nn
import torch.nn.functional as F
import timm
import torchvision.ops as ops
import albumentations as A
from albumentations.pytorch import ToTensorV2
import base64
import time


class Config:
    SEED = 42
    DEVICE = 'cuda' if torch.cuda.is_available() else 'cpu'
    
    NUM_CLASSES = 10
    GLOBAL_SIZE = 768       
    LOCAL_SIZE = 768       
    STRIDE_TRAIN = 512
    STRIDE_VAL = 512
    RARE_CLASS_IDS = [1, 3, 7, 8] 
    BACKBONE = 'convnext_base'
    DROP_PATH = 0.4        
    CLASSES = [
        "Background", "Building-Flooded", "Building-Non-Flooded", 
        "Road-Flooded", "Road-Non-Flooded", "Water", 
        "Tree", "Vehicle", "Pool", "Grass"
    ]
def seed_everything(seed=Config.SEED):
    random.seed(seed)
    os.environ['PYTHONHASHSEED'] = str(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed(seed)
    torch.cuda.manual_seed_all(seed) # Thêm dòng này
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False
seed_everything()

def seed_worker(worker_id):
    worker_seed = torch.initial_seed() % 2**32
    np.random.seed(worker_seed)
    random.seed(worker_seed)

g = torch.Generator()
g.manual_seed(Config.SEED)

class SpatialAttentionGate(nn.Module):
    def __init__(self, in_channels):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(in_channels, 1, kernel_size=7, padding=3, bias=False),
            nn.BatchNorm2d(1),
            nn.Sigmoid() 
        )
    def forward(self, x):
        return self.conv(x)

class ChannelAttention(nn.Module):
    def __init__(self, channels, reduction=16):
        super().__init__()
        self.avg_pool = nn.AdaptiveAvgPool2d(1)
        self.fc = nn.Sequential(
            nn.Linear(channels, channels // reduction, bias=False),
            nn.ReLU(inplace=True),
            nn.Linear(channels // reduction, channels, bias=False),
            nn.Sigmoid()
        )

    def forward(self, x):
        b, c, _, _ = x.size()
        y = self.avg_pool(x).view(b, c)
        y = self.fc(y).view(b, c, 1, 1)
        return x * y

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

class HeavyGLNet(nn.Module):
    def __init__(self, num_classes, backbone_name, drop_path_rate=0.2):
        super().__init__()
        self.backbone = timm.create_model(
            backbone_name, 
            pretrained=True, 
            features_only=True, 
            drop_path_rate=drop_path_rate
        )
        self.backbone.set_grad_checkpointing(True) 
        
        channels = self.backbone.feature_info.channels()
        
        # --- 2. FUSION MODULES ---
        self.fusers = nn.ModuleList([
            DeepFusionModule(channels[1]), # Fusion cho Stride 8
            DeepFusionModule(channels[2]), # Fusion cho Stride 16
            DeepFusionModule(channels[3])  # Fusion cho Stride 32
        ])
        
        # --- 3. DECODER ---
        self.decoder = UperNetHead(channels, num_classes)
        
        # --- 4. AUXILIARY HEAD ---
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
        g_feats = self.backbone(g_img) # List 4 scales
        l_feats = self.backbone(l_img) # List 4 scales
        
        l_feats_fused = [l_feats[0]] 
        
        for i, fuser in enumerate(self.fusers):
            idx = i + 1 # Bắt đầu từ index 1 (Stride 8)
            
            # Truyền kích thước gốc của g_img để RoI Align tính tỉ lệ chính xác
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

class ComprehensiveVisualizer:
    def __init__(self, model_path, config, device='cuda'):
        self.config = config
        self.device = device
    
        self.model = HeavyGLNet(config.NUM_CLASSES, config.BACKBONE).to(self.device)
        
        self.model.load_state_dict(torch.load(model_path, map_location=self.device))
        self.model.eval()
        
        self.normalize = A.Compose([
            A.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
            ToTensorV2()
        ])

        self.activations = {}
        self._register_hooks()

    def get_activation(self, name):
        """Hàm callback để bắt lấy output. Xử lý ghi đè cho Global/Local"""
        def hook(model, input, output):

            if isinstance(output, list):
                out_detached = [o.detach().cpu().to(torch.float32) for o in output]
            else:
                out_detached = output.detach().cpu().to(torch.float32)

            if name == 'backbone':
                if name not in self.activations:
                    self.activations[name] = []
                self.activations[name].append(out_detached)
            else:
                self.activations[name] = out_detached
                
        return hook

    def _register_hooks(self):
        self.model.backbone.register_forward_hook(self.get_activation('backbone'))
        
        for i in range(3):
            self.model.fusers[i].spatial_gate.register_forward_hook(self.get_activation(f'gate_{i}'))
            
        self.model.decoder.ppm_last_conv.register_forward_hook(self.get_activation('fpn_P4'))
        self.model.decoder.fpn_out[2].register_forward_hook(self.get_activation('fpn_P3'))
        self.model.decoder.fpn_out[1].register_forward_hook(self.get_activation('fpn_P2'))
        self.model.decoder.fpn_out[0].register_forward_hook(self.get_activation('fpn_P1'))

    def visualize_all(self, img_path, segmentation_class: dict):
        start = time.time()
        # --- BƯỚC 1: TIỀN XỬ LÝ ẢNH (THỦ THUẬT CHO TOÀN BỘ ẢNH) ---
        orig_img = cv2.imread(img_path)
        if orig_img is None:
            raise FileNotFoundError(f"❌ Không tìm thấy ảnh tại: {img_path}")
        orig_img = cv2.cvtColor(orig_img, cv2.COLOR_BGR2RGB)
        
        # 1. Global Image (Resize toàn ảnh)
        g_img_resized = cv2.resize(orig_img, (self.config.GLOBAL_SIZE, self.config.GLOBAL_SIZE))
        g_tensor = self.normalize(image=g_img_resized)['image'].unsqueeze(0).to(self.device)
        
        # 2. Local Image (CŨNG DÙNG TOÀN BỘ ẢNH THAY VÌ CROP)
        l_img_resized = cv2.resize(orig_img, (self.config.LOCAL_SIZE, self.config.LOCAL_SIZE))
        l_tensor = self.normalize(image=l_img_resized)['image'].unsqueeze(0).to(self.device)
        
        bbox = torch.tensor([[0.0, 0.0, float(self.config.GLOBAL_SIZE), float(self.config.GLOBAL_SIZE)]], dtype=torch.float32).to(self.device)

        # --- BƯỚC 2: CHẠY MODEL ĐỂ THU THẬP DỮ LIỆU ---
        with torch.no_grad():
            with torch.amp.autocast('cuda', enabled=True):
                outputs = self.model(g_tensor, l_tensor, bbox)
                logits = outputs["main"] 
                probs = torch.nn.functional.softmax(logits, dim=1)[0].cpu().numpy()

        def ndarray_to_base64(img_array, image_format=".png"):

            if img_array.dtype != np.uint8:
                img_array = np.clip(img_array * 255.0, 0, 255).astype(np.uint8)

            if img_array.ndim == 3:
            # RGB -> BGR để cv2.imencode encode đúng màu
                img_array = cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR)

            success, encoded_img = cv2.imencode(image_format, img_array)
            if not success:
                raise ValueError("❌ Không thể encode ảnh sang base64")

            return base64.b64encode(encoded_img.tobytes()).decode("utf-8")


        result = {}
        focus_classes = segmentation_class 
        class_colors = {
          1: [255, 0, 0],      # đỏ
          5: [0, 255, 0],      # xanh lá
          3: [0, 0, 255],      # xanh dương
          2: [255, 255, 0],    # vàng
        }
  
        h_img, w_img = l_img_resized.shape[:2]
        
        for c_idx in focus_classes:
            class_name = self.config.CLASSES[c_idx]
            prob_map = probs[c_idx]

            if not isinstance(prob_map, np.ndarray) or prob_map.ndim != 2:
                raise ValueError(
                    f"❌ probs[{c_idx}] phải là map 2D, nhưng hiện tại có shape: "
                    f"{getattr(prob_map, 'shape', type(prob_map))}"
                )

            binary_map = (prob_map > 0.8).astype(np.uint8)

            if binary_map.shape != (h_img, w_img):
                binary_map = cv2.resize(
                    binary_map,
                    (w_img, h_img),
                    interpolation=cv2.INTER_NEAREST
                )

            color_rgb = np.array(class_colors[c_idx], dtype=np.uint8)

            # Mask nền trắng, vùng class là màu riêng
            mask_rgb = np.ones((h_img, w_img, 3), dtype=np.uint8) * 255
            mask_rgb[binary_map == 1] = color_rgb

            # Overlay
            base_img = l_img_resized.copy().astype(np.float32)
            if base_img.max() > 1.0:
                base_img = base_img / 255.0

            overlay_img = base_img.copy()
            alpha = 0.8
            color_float = color_rgb.astype(np.float32) / 255.0
            mask_bool = binary_map.astype(bool)

            overlay_img[mask_bool] = (
                (1 - alpha) * overlay_img[mask_bool] + alpha * color_float
            )

            # result[f"mask_{class_name}"] = ndarray_to_base64(mask_rgb, image_format=".png")
            # result[f"mask_{class_name}_overlay"] = ndarray_to_base64(overlay_img, image_format=".png")

        all_overlay_img = l_img_resized.copy().astype(np.float32)
        if all_overlay_img.max() > 1.0:
            all_overlay_img = all_overlay_img / 255.0

        alpha = 0.8

        for c_idx in focus_classes:
            prob_map = probs[c_idx]
            binary_map = (prob_map > 0.8).astype(np.uint8)

            if binary_map.shape != (h_img, w_img):
                binary_map = cv2.resize(binary_map, 
                                        (w_img, h_img), 
                                        interpolation=cv2.INTER_NEAREST
                                        )

            color_rgb = np.array(class_colors[c_idx], dtype=np.uint8)
            color_float = color_rgb.astype(np.float32) / 255.0
            mask_bool = binary_map.astype(bool)

            all_overlay_img[mask_bool] = (
                (1 - alpha) * all_overlay_img[mask_bool] + alpha * color_float
            )

            result["mask_all_overlay"] = ndarray_to_base64(all_overlay_img, image_format=".png")
        end = time.time()
        print(f"Total time inference: {end-start}")
        return result