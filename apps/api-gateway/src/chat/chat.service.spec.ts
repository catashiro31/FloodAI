import { Test } from "@nestjs/testing";
import { TaskStatus } from "../common/task-status";
import { ConversationService } from "../conversation/conversation.service";
import { OrchestrationService } from "../orchestration/orchestration.service";
import { RealtimeService } from "../realtime/realtime.service";
import { TasksService } from "../tasks/tasks.service";
import { ChatService } from "./chat.service";

describe("ChatService", () => {
  let service: ChatService;

  const tasksService = {
    createTaskFromUpload: jest.fn(),
    setError: jest.fn(),
    setSegmentationSuccess: jest.fn(),
    setVlmSuccess: jest.fn(),
    getTask: jest.fn(),
  };

  const conversationService = {
    getSession: jest.fn(),
    ensureSession: jest.fn(),
    recordAssistantResponse: jest.fn(),
    recordUserMessage: jest.fn(),
  };

  const orchestrationService = {
    triggerSegmentation: jest.fn(),
    enqueueVlm: jest.fn(),
  };

  const realtimeService = {
    registerTaskClient: jest.fn(),
    registerTaskSession: jest.fn(),
    registerSessionClient: jest.fn(),
    sendStatus: jest.fn(),
    sendReply: jest.fn(),
    getClientIdForTask: jest.fn(),
    getSessionIdForTask: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: TasksService, useValue: tasksService },
        { provide: ConversationService, useValue: conversationService },
        { provide: OrchestrationService, useValue: orchestrationService },
        { provide: RealtimeService, useValue: realtimeService },
      ],
    }).compile();

    service = moduleRef.get(ChatService);
  });

  it("creates a task, ensures session, and triggers segmentation on upload", async () => {
    tasksService.createTaskFromUpload.mockResolvedValue({
      job_id: "job-1",
      session_id: "11111111-1111-1111-1111-111111111111",
      image_url: "https://example.com/image.png",
      status: TaskStatus.Queued,
    });

    const result = await service.handleUpload(
      {
        buffer: Buffer.from("x"),
        mimetype: "image/png",
      } as Express.Multer.File,
      { question: "Muc nuoc o dau cao nhat?" },
      "client-1",
      "11111111-1111-1111-1111-111111111111",
    );

    expect(tasksService.createTaskFromUpload).toHaveBeenCalled();
    expect(conversationService.ensureSession).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      "job-1",
      "Muc nuoc o dau cao nhat?",
    );
    expect(realtimeService.registerSessionClient).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      "client-1",
    );
    expect(orchestrationService.triggerSegmentation).toHaveBeenCalled();
    expect(result).toEqual({
      jobId: "job-1",
      sessionId: "11111111-1111-1111-1111-111111111111",
      status: TaskStatus.Queued,
      imageUrl: "https://example.com/image.png",
    });
  });

  it("marks the task as error when segmentation callback fails", async () => {
    realtimeService.getClientIdForTask.mockReturnValue("client-1");
    tasksService.getTask.mockResolvedValue({
      job_id: "job-1",
      session_id: "11111111-1111-1111-1111-111111111111",
      status: TaskStatus.ProcessingSegmentation,
    });

    const response = await service.handleSegmentationWebhook({
      job_id: "job-1",
      status: TaskStatus.Error,
      error_code: "SEGMENTATION_FAILED",
      error_message: "mask generation failed",
    });

    expect(tasksService.setError).toHaveBeenCalledWith(
      "job-1",
      "SEGMENTATION_FAILED",
      "mask generation failed",
    );
    expect(orchestrationService.enqueueVlm).not.toHaveBeenCalled();
    expect(response).toEqual({ status: "ok" });
  });

  it("queues VLM after segmentation success", async () => {
    realtimeService.getClientIdForTask.mockReturnValue("client-1");
    tasksService.getTask.mockResolvedValue({
      job_id: "job-1",
      session_id: "11111111-1111-1111-1111-111111111111",
      status: TaskStatus.ProcessingSegmentation,
    });
    tasksService.setSegmentationSuccess.mockResolvedValue({
      job_id: "job-1",
      session_id: "11111111-1111-1111-1111-111111111111",
      question: "Summarize the flood risk",
      mask_all_overlay: "https://example.com/mask.png",
    });

    await service.handleSegmentationWebhook({
      job_id: "job-1",
      status: TaskStatus.SuccessSegmentation,
      mask_all_overlay: "https://example.com/mask.png",
    });

    expect(tasksService.setSegmentationSuccess).toHaveBeenCalledWith(
      "job-1",
      "https://example.com/mask.png",
    );
    expect(orchestrationService.enqueueVlm).toHaveBeenCalledWith(
      expect.objectContaining({ job_id: "job-1" }),
      "",
      false,
      "client-1",
    );
  });

  it("ignores duplicate segmentation callbacks after downstream processing advanced", async () => {
    realtimeService.getClientIdForTask.mockReturnValue("client-1");
    tasksService.getTask.mockResolvedValue({
      job_id: "job-1",
      session_id: "11111111-1111-1111-1111-111111111111",
      status: TaskStatus.ProcessingVlm,
    });

    const result = await service.handleSegmentationWebhook({
      job_id: "job-1",
      status: TaskStatus.SuccessSegmentation,
      mask_all_overlay: "https://example.com/mask.png",
    });

    expect(tasksService.setSegmentationSuccess).not.toHaveBeenCalled();
    expect(orchestrationService.enqueueVlm).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "duplicate-ignored" });
  });

  it("persists session and emits realtime payload when vlm succeeds", async () => {
    realtimeService.getClientIdForTask.mockReturnValue("client-1");
    tasksService.getTask.mockResolvedValue({
      job_id: "job-1",
      session_id: "11111111-1111-1111-1111-111111111111",
      status: TaskStatus.ProcessingVlm,
    });
    tasksService.setVlmSuccess.mockResolvedValue({
      job_id: "job-1",
      session_id: "11111111-1111-1111-1111-111111111111",
      mask_all_overlay: "https://example.com/mask.png",
    });

    await service.handleVlmWebhook({
      job_id: "job-1",
      session_id: "11111111-1111-1111-1111-111111111111",
      status: TaskStatus.SuccessVlm,
      reply: "High flood depth around the southern road.",
      context: { severity: "high" },
      history: [],
    });

    expect(tasksService.setVlmSuccess).toHaveBeenCalledWith(
      "job-1",
      "High flood depth around the southern road.",
      "11111111-1111-1111-1111-111111111111",
    );
    expect(conversationService.recordAssistantResponse).toHaveBeenCalled();
    expect(realtimeService.sendReply).toHaveBeenCalledWith(
      "client-1",
      expect.objectContaining({
        reply: "High flood depth around the southern road.",
        jobId: "job-1",
      }),
      "11111111-1111-1111-1111-111111111111",
    );
  });

  it("replays realtime reply when callback arrives after task already marked success", async () => {
    realtimeService.getClientIdForTask.mockReturnValue("client-1");
    tasksService.getTask.mockResolvedValue({
      job_id: "job-1",
      session_id: "11111111-1111-1111-1111-111111111111",
      status: TaskStatus.SuccessVlm,
      vlm_analysis: "High flood depth around the southern road.",
      mask_all_overlay: "https://example.com/mask.png",
    });

    const response = await service.handleVlmWebhook({
      job_id: "job-1",
      session_id: "11111111-1111-1111-1111-111111111111",
      status: TaskStatus.SuccessVlm,
      reply: "High flood depth around the southern road.",
      context: { severity: "high" },
      history: [],
    });

    expect(tasksService.setVlmSuccess).not.toHaveBeenCalled();
    expect(realtimeService.sendReply).toHaveBeenCalledWith(
      "client-1",
      expect.objectContaining({
        reply: "High flood depth around the southern road.",
        jobId: "job-1",
      }),
      "11111111-1111-1111-1111-111111111111",
    );
    expect(response).toEqual({ status: "replayed" });
  });

  it("returns task status merged with session state", async () => {
    tasksService.getTask.mockResolvedValue({
      job_id: "job-1",
      session_id: "11111111-1111-1111-1111-111111111111",
      status: TaskStatus.SuccessVlm,
      image_url: "https://example.com/image.png",
      mask_all_overlay: "https://example.com/mask.png",
      vlm_analysis: "Final report",
      error_code: null,
      error_message: null,
      updated_at: "2026-04-01T10:00:00.000Z",
    });
    conversationService.getSession.mockResolvedValue({
      session_id: "11111111-1111-1111-1111-111111111111",
      history: [],
    });

    const result = await service.getStatus("job-1");

    expect(result).toEqual(
      expect.objectContaining({
        jobId: "job-1",
        sessionId: "11111111-1111-1111-1111-111111111111",
        reply: "Final report",
        session: expect.objectContaining({
          session_id: "11111111-1111-1111-1111-111111111111",
        }),
      }),
    );
  });

  it("queues follow-up VLM questions when jobId and sessionId are present", async () => {
    tasksService.getTask.mockResolvedValue({
      job_id: "job-2",
      session_id: "22222222-2222-2222-2222-222222222222",
    });

    const result = await service.handleHttpMessage({
      message: "Can you focus on the eastern bridge?",
      jobId: "job-2",
      sessionId: "22222222-2222-2222-2222-222222222222",
      reset: false,
    });

    expect(conversationService.recordUserMessage).toHaveBeenCalledWith(
      "22222222-2222-2222-2222-222222222222",
      "job-2",
      "Can you focus on the eastern bridge?",
      false,
    );
    expect(orchestrationService.enqueueVlm).toHaveBeenCalled();
    expect(result.queued).toBe(true);
  });
});
