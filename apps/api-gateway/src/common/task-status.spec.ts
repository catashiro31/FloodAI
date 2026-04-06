import {
  TaskStatus,
  canTransitionStatus,
  isTerminalStatus,
} from "./task-status";

describe("task-status", () => {
  it("allows the expected forward transitions", () => {
    expect(
      canTransitionStatus(TaskStatus.Queued, TaskStatus.ProcessingSegmentation),
    ).toBe(true);
    expect(
      canTransitionStatus(
        TaskStatus.ProcessingSegmentation,
        TaskStatus.SuccessSegmentation,
      ),
    ).toBe(true);
    expect(
      canTransitionStatus(
        TaskStatus.SuccessSegmentation,
        TaskStatus.ProcessingVlm,
      ),
    ).toBe(true);
    expect(
      canTransitionStatus(TaskStatus.ProcessingVlm, TaskStatus.SuccessVlm),
    ).toBe(true);
  });

  it("rejects invalid transitions", () => {
    expect(canTransitionStatus(TaskStatus.Queued, TaskStatus.SuccessVlm)).toBe(
      false,
    );
    expect(
      canTransitionStatus(
        TaskStatus.ProcessingSegmentation,
        TaskStatus.ProcessingVlm,
      ),
    ).toBe(false);
  });

  it("marks success and error as terminal outcomes", () => {
    expect(isTerminalStatus(TaskStatus.SuccessVlm)).toBe(true);
    expect(isTerminalStatus(TaskStatus.Error)).toBe(true);
    expect(isTerminalStatus(TaskStatus.Queued)).toBe(false);
  });
});
