export declare enum TaskStatus {
    Queued = "queued",
    ProcessingSegmentation = "processing_segmentation",
    SuccessSegmentation = "success_segmentation",
    ProcessingVlm = "processing_vlm",
    SuccessVlm = "success_vlm",
    Error = "error"
}
export declare function canTransitionStatus(currentStatus: TaskStatus, nextStatus: TaskStatus): boolean;
export declare function isTerminalStatus(status: TaskStatus): boolean;
