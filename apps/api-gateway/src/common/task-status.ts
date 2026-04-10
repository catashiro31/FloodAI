export enum TaskStatus {
  Queued = "queued",
  ProcessingSegmentation = "processing_segmentation",
  SuccessSegmentation = "success_segmentation",
  ProcessingVlm = "processing_vlm",
  SuccessVlm = "success_vlm",
  Error = "error",
}

const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  [TaskStatus.Queued]: [
    TaskStatus.ProcessingSegmentation,
    TaskStatus.ProcessingVlm,
    TaskStatus.Error,
  ],
  [TaskStatus.ProcessingSegmentation]: [
    TaskStatus.SuccessSegmentation,
    TaskStatus.Error,
  ],
  [TaskStatus.SuccessSegmentation]: [
    TaskStatus.ProcessingVlm,
    TaskStatus.Error,
  ],
  [TaskStatus.ProcessingVlm]: [TaskStatus.SuccessVlm, TaskStatus.Error],
  [TaskStatus.SuccessVlm]: [TaskStatus.ProcessingVlm, TaskStatus.Error],
  [TaskStatus.Error]: [
    TaskStatus.ProcessingSegmentation,
    TaskStatus.ProcessingVlm,
  ],
};

export function canTransitionStatus(
  currentStatus: TaskStatus,
  nextStatus: TaskStatus,
): boolean {
  if (currentStatus === nextStatus) {
    return true;
  }

  return ALLOWED_TRANSITIONS[currentStatus]?.includes(nextStatus) ?? false;
}

export function isTerminalStatus(status: TaskStatus): boolean {
  return status === TaskStatus.SuccessVlm || status === TaskStatus.Error;
}
