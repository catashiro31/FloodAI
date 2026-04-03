import os
import torch
import torch.optim as optim
from torch.utils.data import DataLoader
from tqdm import tqdm
import numpy as np
import cv2
import sys
import glob
import csv

# Import từ thư mục cha
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from model.utils import seed_everything, seed_worker
from config_ssl import SSLConfig
from dataloader_ssl import FloodNetSSLDataset
from model_ssl import FloodWizSSL
from loss_ssl import SSLJointLoss

# Danh sách lớp cho FloodNet (Để in log)
CLASS_NAMES = [
    "Background", "Building-Flooded", "Building-Non-Flooded", "Road-Flooded", 
    "Road-Non-Flooded", "Water", "Tree", "Vehicle", "Pool", "Grass"
]

def save_prediction(img_name, pred_mask, epoch, config):
    """
    Lưu bản đồ dự đoán vào thư mục để so sánh trực quan
    """
    save_path = os.path.join(config.SAVE_PRED_DIR, f"epoch_{epoch+1}")
    os.makedirs(save_path, exist_ok=True)
    # Nhân với 25 để các lớp hiển thị rõ hơn trên ảnh grayscale
    cv2.imwrite(os.path.join(save_path, img_name), pred_mask.astype(np.uint8) * 25)

def main():
    seed_everything()
    config = SSLConfig()
    
    # 1. Tìm kiếm và nạp đường dẫn dữ liệu
    def get_paths(split, root=config.DATA_ROOT):
        imgs = sorted(glob.glob(f"{root}/{split}/{split}-org-img/*.jpg"))
        masks = sorted(glob.glob(f"{root}/{split}/{split}-label-img/*.png"))
        return imgs, masks

    train_imgs, train_masks = get_paths('train')
    val_imgs, val_masks = get_paths('val')
    unlabeled_imgs = sorted(glob.glob(f"{config.UNLABELED_DATA_ROOT}/*.jpg") + glob.glob(f"{config.UNLABELED_DATA_ROOT}/*.png"))
    
    print(f"📊 Labeled: {len(train_imgs)} | Unlabeled: {len(unlabeled_imgs)} | Val: {len(val_imgs)}")

    # 2. Xây dựng DataLoaders
    train_ds = FloodNetSSLDataset(train_imgs, train_masks, config, 'train', is_labeled=True)
    train_loader = DataLoader(train_ds, batch_size=config.BATCH_SIZE, shuffle=True, num_workers=4)
    
    unlabeled_ds = FloodNetSSLDataset(unlabeled_imgs, None, config, 'train', is_labeled=False)
    unlabeled_loader = DataLoader(unlabeled_ds, batch_size=config.BATCH_SIZE * config.SSL_RATIO, shuffle=True, num_workers=4)
    
    val_ds = FloodNetSSLDataset(val_imgs, val_masks, config, 'val', is_labeled=True)
    val_loader = DataLoader(val_ds, batch_size=config.BATCH_SIZE, shuffle=False)

    # 3. Model & Loss
    model = FloodWizSSL(config.NUM_CLASSES, config.BACKBONE).to(config.DEVICE)
    criterion = SSLJointLoss(config.NUM_CLASSES).to(config.DEVICE)
    optimizer = optim.AdamW(model.parameters(), lr=config.LR)
    scaler = torch.amp.GradScaler('cuda', enabled=True)

    best_miou = 0.0
    log_file = "ssl_training_log.csv"
    
    # Khởi tạo file log
    with open(log_file, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(["Epoch", "Train_Loss", "Val_Loss", "mIoU"])

    # 4. Training Loop
    for epoch in range(config.EPOCHS):
        model.train()
        epoch_train_loss = 0.0
        
        unlabeled_iter = iter(unlabeled_loader)
        pbar = tqdm(train_loader, desc=f"Epoch {epoch+1}/{config.EPOCHS} [Train]")
        
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
                
            # --- PHASE B: Consistency Loss ---
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
                loss_cons = criterion(outputs_u, bboxes=bboxes_u, 
                                     global_size_hw=(config.GLOBAL_SIZE, config.GLOBAL_SIZE), 
                                     is_labeled=False)
            
            # CONSISTENCY RAMP-UP
            rampup = min(1.0, epoch / config.CONSISTENCY_RAMPUP_EPOCHS)
            total_loss = loss_sup + rampup * config.CONSISTENCY_WEIGHT * loss_cons
            
            scaler.scale(total_loss).backward()
            scaler.step(optimizer)
            scaler.update()
            
            epoch_train_loss += total_loss.item()
            pbar.set_postfix({'Loss': f"{total_loss.item():.4f}", 'Cons': f"{loss_cons.item():.4f}"})

        # --- PHASE C: VALIDATION ---
        model.eval()
        val_loss = 0.0
        inter_meter = torch.zeros(config.NUM_CLASSES).to(config.DEVICE)
        union_meter = torch.zeros(config.NUM_CLASSES).to(config.DEVICE)
        
        with torch.no_grad():
            for i, batch_v in enumerate(tqdm(val_loader, desc="Validation")):
                g_img = batch_v['g_img'].to(config.DEVICE)
                l_img = batch_v['l_img'].to(config.DEVICE)
                targets = batch_v['target'].to(config.DEVICE)
                bboxes = batch_v['bbox'].to(config.DEVICE)
                img_names = batch_v['img_name']
                
                with torch.amp.autocast('cuda', enabled=True):
                    outputs = model(g_img, l_img, bboxes)
                    main_logits = outputs["main"]
                    
                    # Tính Val Loss
                    loss_v = criterion(outputs, target=targets, bboxes=bboxes, 
                                      global_size_hw=(config.GLOBAL_SIZE, config.GLOBAL_SIZE), 
                                      is_labeled=True)
                    val_loss += loss_v.item()
                
                # Tính toán các chỉ số IoU
                preds = torch.argmax(main_logits, dim=1)
                valid_mask = (targets != 255)
                for c in range(config.NUM_CLASSES):
                    p = (preds == c) & valid_mask
                    t = (targets == c) & valid_mask
                    inter_meter[c] += (p & t).sum()
                    union_meter[c] += p.sum() + t.sum() - (p & t).sum()
                
                # Lưu ảnh dự đoán mẫu (Mỗi Epoch lưu 5 tấm đầu)
                if i == 0:
                    for idx in range(min(5, len(img_names))):
                        save_prediction(img_names[idx], preds[idx].cpu().numpy(), epoch, config)

        # 5. TỔNG KẾT VÀ BÁO CÁO
        avg_train_loss = epoch_train_loss / len(train_loader)
        avg_val_loss = val_loss / len(val_loader)
        iou = inter_meter / (union_meter + 1e-6)
        miou = iou.mean().item()
        
        print(f"\n--- Epoch {epoch+1} Report ---")
        print(f"Train Loss: {avg_train_loss:.4f} | Val Loss: {avg_val_loss:.4f} | mIoU: {miou:.4f}")
        
        # Bảng chi tiết từng lớp
        print(f"{'Class':<25} | {'IoU':<10}")
        print("-" * 38)
        for c in range(config.NUM_CLASSES):
            print(f"{CLASS_NAMES[c]:<25} | {iou[c].item():.4f}")
        
        # Lưu log vào CSV
        with open(log_file, 'a', newline='') as f:
            writer = csv.writer(f)
            writer.writerow([epoch+1, avg_train_loss, avg_val_loss, miou])
            
        # Lưu Best Model
        if miou > best_miou:
            best_miou = miou
            torch.save(model.state_dict(), "best_ssl_model.pth")
            print(f"🏆 Epoch {epoch+1}: New Best mIoU: {best_miou:.4f} - Model Saved!")

    print("\n🚀 SSL TRAINING FINISHED!")

if __name__ == "__main__":
    main()
