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
        
        # NOTE: Bỏ qua việc Cache 105GB RAM để tiết kiệm tài nguyên
        # Sử dụng cơ chế đọc trực tiếp từ ổ cứng (On-the-fly)

        self.transforms = A.Compose([
            A.HorizontalFlip(p=0.5),
            A.VerticalFlip(p=0.5),
            A.RandomRotate90(p=0.5),
            A.ShiftScaleRotate(shift_limit=0.0625, scale_limit=0.1, rotate_limit=15, p=0.5, border_mode=0),
            A.OneOf([
                A.RandomBrightnessContrast(p=1),
                A.HueSaturationValue(p=1),
            ], p=0.5),
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
            # Đọc kích thước ảnh để chia lưới
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
                    
                    # Rare Class Mining chỉ áp dụng cho dữ liệu có nhãn
                    if self.is_labeled and self.phase == 'train' and mask_ref is not None:
                        mask_crop = mask_ref[y1:y2, x1:x2]
                        has_rare = np.isin(mask_crop, self.config.RARE_CLASS_IDS).any()
                        if has_rare or random.random() < 0.15:
                            samples.append({'img_idx': idx, 'bbox': [x1, y1, x2, y2], 'orig_size': (img_h, img_w)})
                    else:
                        # Đối với Unlabeled hoặc Val, lấy toàn bộ lưới
                        samples.append({'img_idx': idx, 'bbox': [x1, y1, x2, y2], 'orig_size': (img_h, img_w)})
        return samples

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        sample = self.samples[idx]
        full_img = cv2.cvtColor(cv2.imread(self.img_paths[sample['img_idx']]), cv2.COLOR_BGR2RGB)
        
        full_mask = None
        if self.is_labeled:
            full_mask = cv2.imread(self.mask_paths[sample['img_idx']], 0)
        else:
            # Tạo mask trống cho dữ liệu không nhãn
            full_mask = np.zeros(full_img.shape[:2], dtype=np.uint8)

        # Augmentation
        if self.transforms:
            aug = self.transforms(image=full_img, mask=full_mask)
            full_img, full_mask = aug['image'], aug['mask']

        # Global Image
        g_aug = A.Resize(self.config.GLOBAL_SIZE, self.config.GLOBAL_SIZE)(image=full_img, mask=full_mask)
        g_img_tensor = self.normalize(image=g_aug['image'])['image']
        
        # Local Patch
        x1, y1, x2, y2 = sample['bbox']
        l_img_crop = full_img[y1:y2, x1:x2]
        l_mask_crop = full_mask[y1:y2, x1:x2]

        l_data = self.normalize(image=l_img_crop, mask=l_mask_crop)
        
        # BBox cho Global-Local Fusion
        h, w = full_img.shape[:2]
        scale_h, scale_w = self.config.GLOBAL_SIZE / h, self.config.GLOBAL_SIZE / w
        bbox_tensor = torch.tensor([
            x1 * scale_w, y1 * scale_h, x2 * scale_w, y2 * scale_h
        ], dtype=torch.float32)

        res = {
            'g_img': g_img_tensor,
            'l_img': l_data['image'],
            'bbox': bbox_tensor,
            'img_name': os.path.basename(self.img_paths[sample['img_idx']])
        }
        if self.is_labeled:
            res['target'] = l_data['mask'].long()
            
        return res
