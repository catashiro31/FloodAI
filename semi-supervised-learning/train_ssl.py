import os
import torch
import torch.optim as optim
from torch.utils.data import DataLoader
from tqdm import tqdm
import numpy as np
import cv2
import sys

# Import từ thư mục cha
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from utils import seed_everything, seed_worker
from config_ssl import SSLConfig
from dataloader_ssl import FloodNetSSLDataset
from model_ssl import FloodWizSSL
from loss_ssl import SSLJointLoss

def save_prediction(img_name, pred_mask, epoch, config):
    """
    Lưu bản đồ dự đoán vào thư mục để so sánh
    """
    save_path = os.path.join(config.SAVE_PRED_DIR, f"epoch_{epoch+1}")
    os.makedirs(save_path, exist_ok=True)
    
    # Chuyển mask sang màu sắc (tùy chọn) hoặc để nguyên label
    cv2.imwrite(os.path.join(save_path, img_name), pred_mask.astype(np.uint8) * 25)

def main():
    seed_everything()
    config = SSLConfig()
    
    # 1. Tìm kiếm dữ liệu
    def get_paths(split, root=config.DATA_ROOT):
        # ... logic giống train.py cũ ...
        imgs = sorted(glob.glob(f"{root}/{split}/{split}-org-img/*.jpg"))
        masks = sorted(glob.glob(f"{root}/{split}/{split}-label-img/*.png"))
        return imgs, masks

    import glob
    train_imgs, train_masks = get_paths('train')
    val_imgs, val_masks = get_paths('val')
    # Thêm dữ liệu không nhãn
    unlabeled_imgs = sorted(glob.glob(f"{config.UNLABELED_DATA_ROOT}/*.jpg") + glob.glob(f"{config.UNLABELED_DATA_ROOT}/*.png"))
    
    print(f"📊 Labeled: {len(train_imgs)} | Unlabeled: {len(unlabeled_imgs)} | Val: {len(val_imgs)}")

    # 2. DataLoaders
    # Labeled
    train_ds = FloodNetSSLDataset(train_imgs, train_masks, config, 'train', is_labeled=True)
    train_loader = DataLoader(train_ds, batch_size=config.BATCH_SIZE, shuffle=True, num_workers=4)
    
    # Unlabeled (Tối ưu hóa số lượng patch trên 1 epoch)
    unlabeled_ds = FloodNetSSLDataset(unlabeled_imgs, None, config, 'train', is_labeled=False)
    unlabeled_loader = DataLoader(unlabeled_ds, batch_size=config.BATCH_SIZE * config.SSL_RATIO, shuffle=True, num_workers=4)
    
    # Val
    val_ds = FloodNetSSLDataset(val_imgs, val_masks, config, 'val', is_labeled=True)
    val_loader = DataLoader(val_ds, batch_size=config.BATCH_SIZE, shuffle=False)

    # 3. Model & Loss
    model = FloodWizSSL(config.NUM_CLASSES, config.BACKBONE).to(config.DEVICE)
    criterion = SSLJointLoss(config.NUM_CLASSES).to(config.DEVICE)
    optimizer = optim.AdamW(model.parameters(), lr=config.LR)
    scaler = torch.amp.GradScaler('cuda', enabled=True)

    # 4. Training Loop
    for epoch in range(config.EPOCHS):
        model.train()
        train_loss = 0.0
        
        # Interleave labeled and unlabeled
        unlabeled_iter = iter(unlabeled_loader)
        
        pbar = tqdm(train_loader, desc=f"Epoch {epoch+1}/{config.EPOCHS}")
        for batch_l in pbar:
            optimizer.zero_grad()
            
            # --- PHASE A: Supervised Loss ---
            g_img_l = batch_l['g_img'].to(config.DEVICE)
            l_img_l = batch_l['l_img'].to(config.DEVICE)
            targets_l = batch_l['target'].to(config.DEVICE)
            bboxes_l = batch_l['bbox'].to(config.DEVICE)
            
            with torch.amp.autocast('cuda', enabled=True):
                outputs_l = model(g_img_l, l_img_l, bboxes_l)
                loss_sup = criterion(outputs_l, target=targets_l, 
                                     bboxes=bboxes_l, 
                                     global_size_hw=(config.GLOBAL_SIZE, config.GLOBAL_SIZE),
                                     is_labeled=True)
                
            # --- PHASE B: Consistency Loss (Global-Local) ---
            try:
                batch_u = next(unlabeled_iter)
            except StopIteration:
                unlabeled_iter = iter(unlabeled_loader)
                batch_u = next(unlabeled_iter)
            
            g_img_u = batch_u['g_img'].to(config.DEVICE)
            l_img_u = batch_u['l_img'].to(config.DEVICE)
            bboxes_u = batch_u['bbox'].to(config.DEVICE)
            
            with torch.amp.autocast('cuda', enabled=True):
                outputs_u = model(g_img_u, l_img_u, bboxes_u)
                
                # Tính sự nhất quán giữa Fusion và Global trên ảnh unlabeled
                loss_cons = criterion(outputs_u, bboxes=bboxes_u, 
                                     global_size_hw=(config.GLOBAL_SIZE, config.GLOBAL_SIZE), 
                                     is_labeled=False)
            
            # WARMUP FOR CONSISTENCY
            rampup = min(1.0, epoch / config.CONSISTENCY_RAMPUP_EPOCHS)
            total_loss = loss_sup + rampup * config.CONSISTENCY_WEIGHT * loss_cons
            
            scaler.scale(total_loss).backward()
            scaler.step(optimizer)
            scaler.update()
            
            train_loss += total_loss.item()
            pbar.set_postfix({'Loss': f"{total_loss.item():.4f}", 'Cons': f"{loss_cons.item():.4f}"})

        # --- VALIDATION ---
        model.eval()
        if (epoch + 1) % config.SAVE_FREQ_EPOCHS == 0:
            print("📸 Saving Prediction Maps...")
            with torch.no_grad():
                for i, batch_v in enumerate(val_loader):
                    if i > 5: break # Chỉ lưu 5 tấm để test
                    g_img = batch_v['g_img'].to(config.DEVICE)
                    l_img = batch_v['l_img'].to(config.DEVICE)
                    bboxes = batch_v['bbox'].to(config.DEVICE)
                    img_names = batch_v['img_name']
                    
                    outputs = model(g_img, l_img, bboxes)
                    preds = torch.argmax(outputs['main'], dim=1).cpu().numpy()
                    
                    for idx, name in enumerate(img_names):
                        save_prediction(name, preds[idx], epoch, config)

    print("🚀 SSL TRAINING FINISHED!")

if __name__ == "__main__":
    main()
