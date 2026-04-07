import cv2
import numpy as np
import torch
import random
import albumentations as A
from albumentations.pytorch import ToTensorV2
from torch.utils.data import Dataset
import os
import glob
from tqdm import tqdm

class FloodNetSSLDataset(Dataset):
    def __init__(self, img_paths, mask_paths, config, phase='train', is_labeled=True):
        self.config = config
        self.phase = phase
        self.img_paths = img_paths
        self.mask_paths = mask_paths
        self.is_labeled = is_labeled
        
        # Chỉ dùng các phép biến đổi về màu sắc/nhiễu ở cấp độ Patch
        self.pixel_transforms = A.Compose([
            A.OneOf([
                A.RandomBrightnessContrast(p=1),
                A.HueSaturationValue(p=1),
            ], p=0.5),
            A.GaussNoise(p=0.2),
        ]) if phase == 'train' else None

        self.normalize = A.Compose([
            A.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
            ToTensorV2()
        ])

        self.samples = self._make_grid()

    def _make_grid(self):
        samples = []
        stride = self.config.STRIDE_TRAIN if self.phase == 'train' else self.config.STRIDE_VAL
        
        for idx in range(len(self.img_paths)):
            img_info = cv2.imread(self.img_paths[idx])
            if img_info is None: continue
            img_h, img_w = img_info.shape[:2]
            
            mask_ref = None
            if self.is_labeled and self.phase == 'train':
                mask_ref = cv2.imread(self.mask_paths[idx], 0)

            for y in range(0, img_h, stride):
                for x in range(0, img_w, stride):
                    y2 = min(img_h, y + self.config.LOCAL_SIZE)
                    x2 = min(img_w, x + self.config.LOCAL_SIZE)
                    y1 = max(0, y2 - self.config.LOCAL_SIZE)
                    x1 = max(0, x2 - self.config.LOCAL_SIZE)
                    
                    if self.is_labeled and self.phase == 'train' and mask_ref is not None:
                        mask_crop = mask_ref[y1:y2, x1:x2]
                        has_rare = np.isin(mask_crop, self.config.RARE_CLASS_IDS).any()
                        if has_rare or random.random() < 0.15:
                            samples.append({'img_idx': idx, 'bbox': [x1, y1, x2, y2]})
                    else:
                        samples.append({'img_idx': idx, 'bbox': [x1, y1, x2, y2]})
        return samples

    def apply_spatial_aug(self, img, mask, bbox, h_img, w_img):
        """
        Đồng bộ hóa phép lật và xoay 90 độ cho cả Global và Local
        """
        x1, y1, x2, y2 = bbox
        
        # 1. Flip ngang
        if random.random() > 0.5:
            img = cv2.flip(img, 1)
            mask = cv2.flip(mask, 1)
            x1, x2 = w_img - x2, w_img - x1
            
        # 2. Flip dọc
        if random.random() > 0.5:
            img = cv2.flip(img, 0)
            mask = cv2.flip(mask, 0)
            y1, y2 = h_img - y2, h_img - y1
            
        # 3. Xoay 90 độ (Chỉ quay 90, 180, 270)
        k = random.randint(0, 3) # 0, 90, 180, 270
        if k > 0:
            img = np.rot90(img, k)
            mask = np.rot90(mask, k)
            for _ in range(k):
                # Tọa độ mới sau khi quay 90 độ CW: x_new = h - y, y_new = x
                x1, y1, x2, y2 = h_img - y2, x1, h_img - y1, x2
                h_img, w_img = w_img, h_img
                
        return img, mask, [x1, y1, x2, y2]

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        sample = self.samples[idx]
        full_img = cv2.cvtColor(cv2.imread(self.img_paths[sample['img_idx']]), cv2.COLOR_BGR2RGB)
        
        if self.is_labeled:
            full_mask = cv2.imread(self.mask_paths[sample['img_idx']], 0)
        else:
            full_mask = np.zeros(full_img.shape[:2], dtype=np.uint8)

        h_orig, w_orig = full_img.shape[:2]
        bbox_orig = sample['bbox']

        # 1. Thực hiện Spatial Augmentation trên ẢNH LỚN và đồng bộ Bbox
        if self.phase == 'train':
            full_img, full_mask, bbox_aug = self.apply_spatial_aug(full_img, full_mask, bbox_orig, h_orig, w_orig)
        else:
            bbox_aug = bbox_orig

        h_new, w_new = full_img.shape[:2]
        x1, y1, x2, y2 = [int(v) for v in bbox_aug]

        # 2. Cắt Patch Local
        # Đảm bảo index không vượt quá giới hạn ảnh sau khi xoay
        x1, x2 = max(0, x1), min(w_new, x2)
        y1, y2 = max(0, y1), min(h_new, y2)
        
        l_img_crop = full_img[y1:y2, x1:x2]
        l_mask_crop = full_mask[y1:y2, x1:x2]

        # 3. QUAN TRỌNG: Pad nếu ảnh nhỏ hoặc bị cắt sát biên
        cur_h, cur_w = l_img_crop.shape[:2]
        target_size = self.config.LOCAL_SIZE
        if cur_h < target_size or cur_w < target_size:
            pad_h = max(0, target_size - cur_h)
            pad_w = max(0, target_size - cur_w)
            l_img_crop = cv2.copyMakeBorder(l_img_crop, 0, pad_h, 0, pad_w, cv2.BORDER_REFLECT_101)
            l_mask_crop = cv2.copyMakeBorder(l_mask_crop, 0, pad_h, 0, pad_w, cv2.BORDER_REFLECT_101)

        # 4. Pixel Augmentation (Chỉ trên Patch cho nhanh)
        if self.pixel_transforms:
            aug = self.pixel_transforms(image=l_img_crop, mask=l_mask_crop)
            l_img_crop, l_mask_crop = aug['image'], aug['mask']

        # 5. Global Image (Resize từ ảnh đã bị Augment)
        g_img = cv2.resize(full_img, (self.config.GLOBAL_SIZE, self.config.GLOBAL_SIZE))
        
        # Normalize
        l_data = self.normalize(image=l_img_crop, mask=l_mask_crop)
        g_data = self.normalize(image=g_img)
        
        # Tính toán Bbox Tensor cuối cùng (đã chuẩn hóa theo GLOBAL_SIZE)
        scale_h, scale_w = self.config.GLOBAL_SIZE / h_new, self.config.GLOBAL_SIZE / w_new
        bbox_tensor = torch.tensor([
            x1 * scale_w, y1 * scale_h, x2 * scale_w, y2 * scale_h
        ], dtype=torch.float32)

        res = {
            'g_img': g_data['image'],
            'l_img': l_data['image'],
            'bbox': bbox_tensor,
            'img_name': os.path.basename(self.img_paths[sample['img_idx']])
        }
        if self.is_labeled:
            res['target'] = l_data['mask'].long()
            
        return res
