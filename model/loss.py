import torch
import torch.nn as nn
import torch.nn.functional as F

def lovasz_grad(gt_sorted):
    p = len(gt_sorted)
    gts = gt_sorted.sum()
    intersection = gts - gt_sorted.cumsum(0)
    union = gts + (1 - gt_sorted).cumsum(0)
    jaccard = 1. - intersection / union
    if p > 1:
        jaccard[1:p] = jaccard[1:p] - jaccard[0:-1]
    return jaccard

def lovasz_softmax_flat(probas, labels, classes='present', ignore_index=255):
    if probas.numel() == 0:
        return probas * 0.
    C = probas.size(1)
    losses = []
    
    class_to_sum = list(range(C)) if classes in ['all', 'present'] else classes
    
    for c in class_to_sum:
        fg = (labels == c).float()
        if (classes == 'present' and fg.sum() == 0):
            continue
        if c == ignore_index:
            continue
            
        class_pred = probas[:, c]

        errors = (fg - class_pred).abs()
        errors_sorted, perm = torch.sort(errors, 0, descending=True)
        perm = perm.data
        fg_sorted = fg[perm]
        
        losses.append(torch.dot(errors_sorted, lovasz_grad(fg_sorted)))
        
    if len(losses) > 0:
        return sum(losses) / len(losses)
    else:
        return probas * 0.

class FocalLoss(nn.Module):
    def __init__(self, alpha=None, gamma=2.0, ignore_index=255):
        super(FocalLoss, self).__init__()
        self.gamma = gamma
        self.ignore_index = ignore_index
        self.alpha = alpha 

    def forward(self, inputs, targets):
        ce_loss = F.cross_entropy(inputs, targets, reduction='none', ignore_index=self.ignore_index)
        pt = torch.exp(-ce_loss)

        focal_loss = (1 - pt) ** self.gamma * ce_loss
        
        return focal_loss.mean()

class JointLoss(nn.Module):
    def __init__(self, num_classes):
        super().__init__()
        self.num_classes = num_classes
        self.focal = FocalLoss(gamma=2.0, ignore_index=255) 

    def forward(self, inputs, targets):
        main_logits = inputs["main"]
        loss_main = self.compute_single_loss(main_logits, targets)
        
        loss_aux = 0.0
        if "aux" in inputs and inputs["aux"] is not None:
            loss_aux = self.compute_single_loss(inputs["aux"], targets)
            
        return loss_main + 0.4 * loss_aux

    def compute_single_loss(self, logits, targets):
        loss_focal = self.focal(logits, targets)
        
        probas = F.softmax(logits, dim=1)
        mask = targets != 255
        probas_flat = probas.permute(0, 2, 3, 1)[mask, :]
        targets_flat = targets[mask]

        loss_lovasz = 0.0
        if probas_flat.numel() > 0:
            loss_lovasz = lovasz_softmax_flat(probas_flat, targets_flat)
            
        return loss_focal + 0.75 * loss_lovasz