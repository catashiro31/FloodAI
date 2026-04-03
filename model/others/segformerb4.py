import os
import cv2
import torch
import torch.nn as nn
import torch.optim as optim
import albumentations as A
from albumentations.pytorch import ToTensorV2
from torch.utils.data import Dataset, DataLoader
import segmentation_models_pytorch as smp
import torchmetrics
from tqdm import tqdm

IMAGE_SIZE = 768
BATCH_SIZE = 2
ACCUMULATION_STEPS = 8
NUM_EPOCHS = 40

def get_training_augmentation():
    train_transform = A.Compose([
        A.Resize(height=IMAGE_SIZE, width=IMAGE_SIZE),
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
        A.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ToTensorV2()
    ])
    return train_transform

def get_validation_augmentation():
    val_transform = [
        A.Resize(height=IMAGE_SIZE, width=IMAGE_SIZE),
        A.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ToTensorV2(),
    ]
    return A.Compose(val_transform)

class FloodNetDataset(Dataset):
    def __init__(self, images_dir, masks_dir, augmentation=None):
        self.images_dir = images_dir
        self.masks_dir = masks_dir
        self.augmentation = augmentation
        
        self.images_fps = sorted([os.path.join(images_dir, image_id) for image_id in os.listdir(images_dir) if image_id.endswith(('.jpg', '.png', '.jpeg'))])
        self.masks_fps = sorted([os.path.join(masks_dir, mask_id) for mask_id in os.listdir(masks_dir) if mask_id.endswith(('.jpg', '.png', '.jpeg'))])
        assert len(self.images_fps) == len(self.masks_fps), "Số lượng ảnh và mask không khớp nhau!"

    def __len__(self):
        return len(self.images_fps)

    def __getitem__(self, i):
        image = cv2.imread(self.images_fps[i])
        image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB) 
        mask = cv2.imread(self.masks_fps[i], cv2.IMREAD_GRAYSCALE)
        
        if self.augmentation:
            sample = self.augmentation(image=image, mask=mask)
            image, mask = sample['image'], sample['mask']
            
        mask = mask.long()
        return image, mask

if __name__ == "__main__":
    TRAIN_IMG_DIR = '/kaggle/input/datasets/catashiro31/floodnet/FloodNet-Supervised_v1.0/train/train-org-img'
    TRAIN_MASK_DIR = '/kaggle/input/datasets/catashiro31/floodnet/FloodNet-Supervised_v1.0/train/train-label-img'
    VAL_IMG_DIR = '/kaggle/input/datasets/catashiro31/floodnet/FloodNet-Supervised_v1.0/val/val-org-img'
    VAL_MASK_DIR = '/kaggle/input/datasets/catashiro31/floodnet/FloodNet-Supervised_v1.0/val/val-label-img'

    train_dataset = FloodNetDataset(TRAIN_IMG_DIR, TRAIN_MASK_DIR, get_training_augmentation())
    val_dataset = FloodNetDataset(VAL_IMG_DIR, VAL_MASK_DIR, get_validation_augmentation())

    train_loader = DataLoader(train_dataset, batch_size=BATCH_SIZE, shuffle=True, num_workers=4, drop_last=True)
    val_loader = DataLoader(val_dataset, batch_size=BATCH_SIZE, shuffle=False, num_workers=4)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Đang chạy trên thiết bị: {device}")
    
    model = smp.Segformer(
        encoder_name="mit_b4", 
        encoder_weights="imagenet", # Khởi tạo bằng trọng số pretrained xịn
        in_channels=3, 
        classes=10
    ).to(device)
    
    dice_loss = smp.losses.DiceLoss(mode='multiclass')
    ce_loss = nn.CrossEntropyLoss()
    def criterion(y_pred, y_true):
        return ce_loss(y_pred, y_true) + dice_loss(y_pred, y_true)

    optimizer = optim.AdamW(model.parameters(), lr=1e-4, weight_decay=0.01)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=NUM_EPOCHS)
    iou_metric = torchmetrics.JaccardIndex(task="multiclass", num_classes=10).to(device)
    scaler = torch.amp.GradScaler('cuda', enabled=True)
    best_val_iou = 0.0

    for epoch in range(NUM_EPOCHS):
        print(f"\n--- Epoch {epoch+1}/{NUM_EPOCHS} ---")
        
        model.train()
        train_loss = 0.0
        optimizer.zero_grad() 
        
        train_bar = tqdm(train_loader, desc="Training")
        for i, (images, masks) in enumerate(train_bar):
            images, masks = images.to(device), masks.to(device)
            
            with torch.amp.autocast('cuda', enabled=True):
                outputs = model(images)
                # Tính loss gốc để log (tránh sai số do chia tích lũy)
                raw_loss = criterion(outputs, masks) 
                # Chia để backward
                loss = raw_loss / ACCUMULATION_STEPS
            
            scaler.scale(loss).backward()
            
            if (i + 1) % ACCUMULATION_STEPS == 0:
                scaler.step(optimizer)
                scaler.update()
                optimizer.zero_grad()
            
            # CẬP NHẬT DÒNG NÀY: Dùng raw_loss để cộng dồn chính xác hơn
            train_loss += raw_loss.item() 
            train_bar.set_postfix(loss=raw_loss.item())
            
        avg_train_loss = train_loss / len(train_loader)
            
        scheduler.step()
        
        model.eval()
        val_loss = 0.0
        
        with torch.no_grad():
            val_bar = tqdm(val_loader, desc="Validation")
            for images, masks in val_bar:
                images, masks = images.to(device), masks.to(device)
                
                with torch.amp.autocast('cuda', enabled=True):
                    outputs = model(images)
                    loss = criterion(outputs, masks)
                val_loss += loss.item()
                
                preds = torch.argmax(outputs, dim=1) 
                iou_metric.update(preds, masks)
                
        avg_val_loss = val_loss / len(val_loader)
        epoch_val_iou = iou_metric.compute().item()
        iou_metric.reset()
        
        print(f"Train Loss: {avg_train_loss:.4f} | Val Loss: {avg_val_loss:.4f} | Val mIoU: {epoch_val_iou:.4f}")
        
        if epoch_val_iou > best_val_iou:
            best_val_iou = epoch_val_iou
            torch.save(model.state_dict(), "best_floodnet_segformerb4.pth")
            print(f"🔥 Đã lưu mô hình tốt nhất với mIoU: {best_val_iou:.4f}")

    print("Quá trình huấn luyện đã hoàn tất!")