import torch

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
    
    BATCH_SIZE = 4
    ACCUM_STEPS = 4
    EPOCHS = 40             
    LR = 1e-4               
    WEIGHT_DECAY = 0.05
    
    DATA_ROOT = 'FloodNet-Supervised_v1.0'
    
    MOSAIC_PROB = 0.5
    MIXUP_PROB = 0.0
    
    CLASSES = [
        "Background", "Building-Flooded", "Building-Non-Flooded", 
        "Road-Flooded", "Road-Non-Flooded", "Water", 
        "Tree", "Vehicle", "Pool", "Grass"
    ]