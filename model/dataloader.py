from torch.utils.data import Dataset
import cv2
import numpy as np
import albumentations as A
from tqdm import tqdm
from albumentations.pytorch import ToTensorV2
import random
import torch

class FloodNetHeavyDataset(Dataset):
    def __init__(self, img_paths, mask_paths, config, phase='train'):
        self.config = config
        self.phase = phase
        self.img_paths = img_paths
        self.mask_paths = mask_paths
        self.indices = range(len(img_paths))

        self.cache_images = []
        self.cache_masks = []
        print(f"📥 Loading {phase} data into RAM...")
        for i in tqdm(range(len(img_paths))):
            img = cv2.cvtColor(cv2.imread(img_paths[i]), cv2.COLOR_BGR2RGB)
            mask = cv2.imread(mask_paths[i], 0)
            self.cache_images.append(img)
            self.cache_masks.append(mask)
        print("✅ Cache Data Done!")
        
        self.transforms = A.Compose([
            A.HorizontalFlip(p=0.5),
            A.VerticalFlip(p=0.5),
            A.RandomRotate90(p=0.5),
            A.ShiftScaleRotate(shift_limit=0.0625, scale_limit=0.1, rotate_limit=15, p=0.5, border_mode=0),
        
            A.OneOf([
                A.RandomBrightnessContrast(brightness_limit=0.25, contrast_limit=0.25, p=1),
                A.HueSaturationValue(hue_shift_limit=10, sat_shift_limit=25, val_shift_limit=15, p=1),
                A.RandomGamma(gamma_limit=(80, 120), p=1),
                A.CLAHE(clip_limit=3.0, tile_grid_size=(8, 8), p=1),
            ], p=0.5),
        
            A.OneOf([
                A.GaussianBlur(blur_limit=(3, 5), p=1),
                A.GaussNoise(var_limit=(10.0, 30.0), p=1),
                A.ISONoise(p=1),
            ], p=0.2),
            
        ]) if phase == 'train' else None

        self.normalize = A.Compose([
            A.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
            ToTensorV2()
        ])

        self.samples = self._make_grid()

    def _make_grid(self):
        samples = []
        stride = self.config.STRIDE_TRAIN if self.phase == 'train' else self.config.STRIDE_VAL
        
        print(f"🔄 Indexing & Filtering patches for {self.phase}...")
        
        kept_count = 0
        dropped_count = 0
        
        for idx in range(len(self.img_paths)):
            img_h, img_w = cv2.imread(self.img_paths[idx]).shape[:2]
            
            mask_ref = None
            if self.phase == 'train':
                mask_ref = cv2.imread(self.mask_paths[idx], 0)

            for y in range(0, img_h, stride):
                for x in range(0, img_w, stride):
                    y2 = min(img_h, y + self.config.LOCAL_SIZE)
                    x2 = min(img_w, x + self.config.LOCAL_SIZE)
                    y1 = max(0, y2 - self.config.LOCAL_SIZE)
                    x1 = max(0, x2 - self.config.LOCAL_SIZE)
                    
                    if self.phase == 'train':
                        mask_crop = mask_ref[y1:y2, x1:x2]
                        
                        has_rare = np.isin(mask_crop, self.config.RARE_CLASS_IDS).any()
                        
                        if has_rare:
                            samples.append({
                                'img_idx': idx,
                                'bbox': [x1, y1, x2, y2],
                                'orig_size': (img_h, img_w)
                            })
                            kept_count += 1
                        else:
                            if random.random() < 0.15:
                                samples.append({
                                    'img_idx': idx,
                                    'bbox': [x1, y1, x2, y2],
                                    'orig_size': (img_h, img_w)
                                })
                                kept_count += 1
                            else:
                                dropped_count += 1
                    else:
                        samples.append({
                            'img_idx': idx,
                            'bbox': [x1, y1, x2, y2],
                            'orig_size': (img_h, img_w)
                        })

        if self.phase == 'train':
            print(f"🎯 Mining Result: Kept {kept_count} patches (Rich context), Dropped {dropped_count} patches (Empty/Boring).")
            print(f"📉 Data reduction: {kept_count / (kept_count + dropped_count) * 100:.1f}% of original grid.")
        
        return samples

    def load_img_mask(self, idx):
        return self.cache_images[idx], self.cache_masks[idx]

    def load_mosaic(self, idx):
        indices = [idx] + [random.choice(self.indices) for _ in range(3)]
        random.shuffle(indices)
        
        img0, _ = self.load_img_mask(indices[0])
        h, w = img0.shape[:2]
        
        mosaic_img = np.full((h * 2, w * 2, 3), 114, dtype=np.uint8)
        mosaic_mask = np.full((h * 2, w * 2), 0, dtype=np.uint8)
        
        yc, xc = int(h * random.uniform(0.5, 1.5)), int(w * random.uniform(0.5, 1.5))

        for i, index in enumerate(indices):
            img, mask = self.load_img_mask(index)
            if img.shape[:2] != (h, w):
                img = cv2.resize(img, (w, h))
                mask = cv2.resize(mask, (w, h), interpolation=cv2.INTER_NEAREST)

            if i == 0:
                y1a, y2a, x1a, x2a = max(yc - h, 0), yc, max(xc - w, 0), xc
                y1b, y2b, x1b, x2b = h - (y2a - y1a), h, w - (x2a - x1a), w
            elif i == 1:
                y1a, y2a, x1a, x2a = max(yc - h, 0), yc, xc, min(xc + w, w * 2)
                y1b, y2b, x1b, x2b = h - (y2a - y1a), h, 0, x2a - x1a
            elif i == 2:
                y1a, y2a, x1a, x2a = yc, min(yc + h, h * 2), max(xc - w, 0), xc
                y1b, y2b, x1b, x2b = 0, y2a - y1a, w - (x2a - x1a), w
            elif i == 3:
                y1a, y2a, x1a, x2a = yc, min(yc + h, h * 2), xc, min(xc + w, w * 2)
                y1b, y2b, x1b, x2b = 0, y2a - y1a, 0, x2a - x1a

            mosaic_img[y1a:y2a, x1a:x2a] = img[y1b:y2b, x1b:x2b]
            mosaic_mask[y1a:y2a, x1a:x2a] = mask[y1b:y2b, x1b:x2b]

        mosaic_img = cv2.resize(mosaic_img, (w, h))
        mosaic_mask = cv2.resize(mosaic_mask, (w, h), interpolation=cv2.INTER_NEAREST)
        
        return mosaic_img, mosaic_mask

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        sample = self.samples[idx]
        
        if self.phase == 'train' and random.random() < self.config.MOSAIC_PROB:
            full_img, full_mask = self.load_mosaic(sample['img_idx'])
            h, w = full_img.shape[:2]
            if w > self.config.LOCAL_SIZE and h > self.config.LOCAL_SIZE:
                x1 = np.random.randint(0, w - self.config.LOCAL_SIZE)
                y1 = np.random.randint(0, h - self.config.LOCAL_SIZE)
                x2, y2 = x1 + self.config.LOCAL_SIZE, y1 + self.config.LOCAL_SIZE
            else:
                x1, y1, x2, y2 = 0, 0, w, h
            
            bbox_coords = [x1, y1, x2, y2]
        else:
            full_img, full_mask = self.load_img_mask(sample['img_idx'])
            
            x1, y1, x2, y2 = sample['bbox']
            
            if self.phase == 'train':
                h, w = full_img.shape[:2]
                dx = random.randint(-32, 32)
                dy = random.randint(-32, 32)
                
                new_x1 = np.clip(x1 + dx, 0, w - self.config.LOCAL_SIZE)
                new_y1 = np.clip(y1 + dy, 0, h - self.config.LOCAL_SIZE)
                
                x1, y1 = int(new_x1), int(new_y1)
                x2, y2 = x1 + self.config.LOCAL_SIZE, y1 + self.config.LOCAL_SIZE
            # ------------------------------------
        
            bbox_coords = [x1, y1, x2, y2]

        if self.transforms:
            aug = self.transforms(image=full_img, mask=full_mask)
            full_img = aug['image']
            full_mask = aug['mask']

        g_aug = A.Resize(self.config.GLOBAL_SIZE, self.config.GLOBAL_SIZE)(image=full_img, mask=full_mask)
        g_img_tensor = self.normalize(image=g_aug['image'])['image']
        
        x1, y1, x2, y2 = bbox_coords
        h, w = full_img.shape[:2]
        
        crop_w = x2 - x1
        crop_h = y2 - y1
        
        if x2 > w: x1 = max(0, w - crop_w); x2 = w
        if y2 > h: y1 = max(0, h - crop_h); y2 = h
        if x1 < 0: x1 = 0; x2 = min(w, crop_w)
        if y1 < 0: y1 = 0; y2 = min(h, crop_h)
        
        x1, y1, x2, y2 = int(x1), int(y1), int(x2), int(y2)
        
        l_img_crop = full_img[y1:y2, x1:x2]
        l_mask_crop = full_mask[y1:y2, x1:x2]

        curr_h, curr_w = l_img_crop.shape[:2]
        target_h, target_w = self.config.LOCAL_SIZE, self.config.LOCAL_SIZE
        
        if curr_h < target_h or curr_w < target_w:
            pad_h = target_h - curr_h
            pad_w = target_w - curr_w
            
            l_img_crop = cv2.copyMakeBorder(l_img_crop, 0, pad_h, 0, pad_w, cv2.BORDER_REFLECT_101)
            l_mask_crop = cv2.copyMakeBorder(l_mask_crop, 0, pad_h, 0, pad_w, cv2.BORDER_REFLECT_101)
            
            x2 = x1 + target_w
            y2 = y1 + target_h

        if l_img_crop.shape[:2] != (target_h, target_w):
             l_img_crop = cv2.resize(l_img_crop, (target_w, target_h))
             l_mask_crop = cv2.resize(l_mask_crop, (target_w, target_h), interpolation=cv2.INTER_NEAREST)

        l_data = self.normalize(image=l_img_crop, mask=l_mask_crop)
        
        scale_h = self.config.GLOBAL_SIZE / h
        scale_w = self.config.GLOBAL_SIZE / w
        
        bbox_tensor = torch.tensor([
            max(0, x1 * scale_w), 
            max(0, y1 * scale_h), 
            min(self.config.GLOBAL_SIZE, x2 * scale_w), 
            min(self.config.GLOBAL_SIZE, y2 * scale_h)
        ], dtype=torch.float32)

        return {
            'g_img': g_img_tensor,
            'l_img': l_data['image'],
            'target': l_data['mask'].long(),
            'bbox': bbox_tensor
        }