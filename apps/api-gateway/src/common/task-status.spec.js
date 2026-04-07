"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const task_status_1 = require("./task-status");
describe("task-status", () => {
    it("allows the expected forward transitions", () => {
        expect((0, task_status_1.canTransitionStatus)(task_status_1.TaskStatus.Queued, task_status_1.TaskStatus.ProcessingSegmentation)).toBe(true);
        expect((0, task_status_1.canTransitionStatus)(task_status_1.TaskStatus.ProcessingSegmentation, task_status_1.TaskStatus.SuccessSegmentation)).toBe(true);
        expect((0, task_status_1.canTransitionStatus)(task_status_1.TaskStatus.SuccessSegmentation, task_status_1.TaskStatus.ProcessingVlm)).toBe(true);
        expect((0, task_status_1.canTransitionStatus)(task_status_1.TaskStatus.ProcessingVlm, task_status_1.TaskStatus.SuccessVlm)).toBe(true);
    });
    it("rejects invalid transitions", () => {
        expect((0, task_status_1.canTransitionStatus)(task_status_1.TaskStatus.Queued, task_status_1.TaskStatus.SuccessVlm)).toBe(false);
        expect((0, task_status_1.canTransitionStatus)(task_status_1.TaskStatus.ProcessingSegmentation, task_status_1.TaskStatus.ProcessingVlm)).toBe(false);
    });
    it("marks success and error as terminal outcomes", () => {
        expect((0, task_status_1.isTerminalStatus)(task_status_1.TaskStatus.SuccessVlm)).toBe(true);
        expect((0, task_status_1.isTerminalStatus)(task_status_1.TaskStatus.Error)).toBe(true);
        expect((0, task_status_1.isTerminalStatus)(task_status_1.TaskStatus.Queued)).toBe(false);
    });
});
//# sourceMappingURL=task-status.spec.js.map