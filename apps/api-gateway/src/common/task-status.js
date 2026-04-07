"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStatus = void 0;
exports.canTransitionStatus = canTransitionStatus;
exports.isTerminalStatus = isTerminalStatus;
var TaskStatus;
(function (TaskStatus) {
    TaskStatus["Queued"] = "queued";
    TaskStatus["ProcessingSegmentation"] = "processing_segmentation";
    TaskStatus["SuccessSegmentation"] = "success_segmentation";
    TaskStatus["ProcessingVlm"] = "processing_vlm";
    TaskStatus["SuccessVlm"] = "success_vlm";
    TaskStatus["Error"] = "error";
})(TaskStatus || (exports.TaskStatus = TaskStatus = {}));
const ALLOWED_TRANSITIONS = {
    [TaskStatus.Queued]: [TaskStatus.ProcessingSegmentation, TaskStatus.Error],
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
function canTransitionStatus(currentStatus, nextStatus) {
    var _a, _b;
    if (currentStatus === nextStatus) {
        return true;
    }
    return (_b = (_a = ALLOWED_TRANSITIONS[currentStatus]) === null || _a === void 0 ? void 0 : _a.includes(nextStatus)) !== null && _b !== void 0 ? _b : false;
}
function isTerminalStatus(status) {
    return status === TaskStatus.SuccessVlm || status === TaskStatus.Error;
}
//# sourceMappingURL=task-status.js.map