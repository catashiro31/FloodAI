import os, sys
import glob
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader
from tqdm import tqdm

current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.abspath(os.path.join(current_dir, '..'))
if project_root not in sys.path:
    sys.path.append(project_root)

from FloodAI.model.config import Config
from FloodAI.model.dataloader import FloodNetHeavyDataset
from FloodAI.model.model import HeavyGLNet
from FloodAI.model.loss import JointLoss
from FloodAI.model.utils import seed_everything, seed_worker, train_one_epoch

def main():
    seed_everything()
    g = torch.Generator()
    g.manual_seed(Config.SEED)
    
    def get_paths(split):
        d = Config.DATA_ROOT
        search_path = f"{d}/{split}/{split}-org-img/"
        print(f"🔍 Đang tìm ảnh tại: {search_path}")
        
        if not os.path.exists(search_path):
            print(f"❌ LỖI: Thư mục không tồn tại: {search_path}")
            print(f"📂 Các thư mục có trong {d}: {os.listdir(d)}")
            return [], []

        imgs = sorted(glob.glob(f"{d}/{split}/{split}-org-img/*.jpg") + glob.glob(f"{d}/{split}/{split}-org-img/*.png") + glob.glob(f"{d}/{split}/{split}-org-img/*.jpeg"))
        masks = sorted(glob.glob(f"{d}/{split}/{split}-label-img/*.png"))
        
        print(f"✅ Tìm thấy {len(imgs)} ảnh và {len(masks)} nhãn cho tập {split}")
        return imgs, masks

    train_imgs, train_masks = get_paths('train')
    
    if len(train_imgs) == 0:
        raise ValueError("Không tìm thấy ảnh nào! Vui lòng kiểm tra lại DATA_ROOT.")
    
    train_imgs, train_masks = get_paths('train')
    val_imgs, val_masks = get_paths('val')
    
    train_ds = FloodNetHeavyDataset(train_imgs, train_masks, Config, 'train')
    val_ds = FloodNetHeavyDataset(val_imgs, val_masks, Config, 'val')
    
    train_loader = DataLoader(
        train_ds, 
        batch_size=Config.BATCH_SIZE, 
        shuffle=True, 
        num_workers=4,
        pin_memory=True,     
        persistent_workers=True, 
        prefetch_factor=2,
        worker_init_fn=seed_worker,
        generator=g
    )
    
    val_loader = DataLoader(
        val_ds, 
        batch_size=Config.BATCH_SIZE,
        shuffle=False, 
        num_workers=4,
        pin_memory=True,
        worker_init_fn=seed_worker,
        generator=g
    )

    model = HeavyGLNet(Config.NUM_CLASSES, Config.BACKBONE).to(Config.DEVICE)
    
    total_params = sum(p.numel() for p in model.parameters())
    trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    
    print("-" * 40)
    print(f"📊 Model Architecture: HeavyGLNet + {Config.BACKBONE}")
    print(f"🔢 Total Parameters:     {total_params / 1e6:.2f} M")
    print(f"🔥 Trainable Parameters: {trainable_params / 1e6:.2f} M")
    print("-" * 40)
    
    def get_optimizer_params(model, lr, weight_decay):
        param_optimizer = list(model.named_parameters())
        no_decay = ['bias', 'LayerNorm.bias', 'LayerNorm.weight', 'BatchNorm.weight', 'BatchNorm.bias']
        optimizer_grouped_parameters = [
            {'params': [p for n, p in param_optimizer if not any(nd in n for nd in no_decay)], 'weight_decay': weight_decay},
            {'params': [p for n, p in param_optimizer if any(nd in n for nd in no_decay)], 'weight_decay': 0.0}
        ]
        return optimizer_grouped_parameters

    params = get_optimizer_params(model, Config.LR, Config.WEIGHT_DECAY)
    optimizer = optim.AdamW(params, lr=Config.LR)
    
    def lr_lambda(epoch):
        warmup_epochs = 5
        if epoch < warmup_epochs:
            return float(epoch + 1) / warmup_epochs
        else:
            progress = float(epoch - warmup_epochs) / (Config.EPOCHS - warmup_epochs)
            cosine_coeff = 0.5 * (1.0 + np.cos(np.pi * progress))

            return max(0.05, cosine_coeff)

    scheduler = optim.lr_scheduler.LambdaLR(optimizer, lr_lambda=lr_lambda)
    
    criterion = JointLoss(Config.NUM_CLASSES).to(Config.DEVICE)
    scaler = torch.amp.GradScaler('cuda', enabled=True)
    
    best_miou = 0.0
    
    print("🚀 STARTING HEAVY TRAINING...")
    for epoch in range(Config.EPOCHS):
        train_loss = train_one_epoch(model, train_loader, optimizer, criterion, scaler, epoch)
        scheduler.step()
        
        model.eval()
        inter_meter = torch.zeros(Config.NUM_CLASSES).to(Config.DEVICE)
        union_meter = torch.zeros(Config.NUM_CLASSES).to(Config.DEVICE)
        val_loss_meter = 0.0

        with torch.no_grad():
            for batch in tqdm(val_loader, desc="Val"):
                g_img = batch['g_img'].to(Config.DEVICE)
                l_img = batch['l_img'].to(Config.DEVICE)
                targets = batch['target'].to(Config.DEVICE)
                bboxes = batch['bbox'].to(Config.DEVICE)
                
                with torch.amp.autocast('cuda', enabled=True):
                    outputs = model(g_img, l_img, bboxes)
                    loss_batch = criterion(outputs, targets)
                    val_loss_meter += loss_batch.item()
                
                logits = outputs["main"]
                preds = torch.argmax(logits, dim=1)
                
                valid_mask = (targets != 255)
                for c in range(Config.NUM_CLASSES):
                    p = (preds == c) & valid_mask
                    t = (targets == c) & valid_mask
                    inter_meter[c] += (p & t).sum()
                    union_meter[c] += p.sum() + t.sum() - (p & t).sum()

        avg_val_loss = val_loss_meter / len(val_loader)
        
        iou = inter_meter / (union_meter + 1e-6)
        val_miou = iou[1:].mean().item()

        print(f"Epoch {epoch+1} | Train Loss: {train_loss:.4f} | Val Loss: {avg_val_loss:.4f} | Val mIoU: {val_miou:.4f}")
        
        if val_miou > best_miou:
            best_miou = val_miou
            torch.save(model.state_dict(), "best_model.pth")
            print("🏆 Saved Best Model")

if __name__ == "__main__":
    main()