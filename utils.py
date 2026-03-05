import os
import random
import numpy as np
import torch
import tqdm
from config import Config

def seed_worker():
    worker_seed = torch.initial_seed() % 2**32
    np.random.seed(worker_seed)
    random.seed(worker_seed)

def seed_everything(seed=Config.SEED):
    random.seed(seed)
    os.environ['PYTHONHASHSEED'] = str(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False

def train_one_epoch(model, loader, optimizer, criterion, scaler, epoch):
    model.train()
    total_loss = 0
    pbar = tqdm(loader, desc=f"Epoch {epoch+1}")
    
    optimizer.zero_grad()
    
    for step, batch in enumerate(pbar):
        g_img = batch['g_img'].to(Config.DEVICE)
        l_img = batch['l_img'].to(Config.DEVICE)
        targets = batch['target'].to(Config.DEVICE)
        bboxes = batch['bbox'].to(Config.DEVICE)
        
        with torch.autocast(device_type="cuda", dtype=torch.bfloat16, enabled=True):
            outputs = model(g_img, l_img, bboxes)
            loss = criterion(outputs, targets)
            loss = loss / Config.ACCUM_STEPS
            
        scaler.scale(loss).backward()
        
        if (step + 1) % Config.ACCUM_STEPS == 0:
            scaler.step(optimizer)
            scaler.update()
            optimizer.zero_grad()
            
        total_loss += loss.item() * Config.ACCUM_STEPS
        pbar.set_postfix(loss=total_loss/(step+1))
        
    return total_loss / len(loader)