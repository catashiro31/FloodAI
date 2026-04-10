import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as request from "supertest";
import { ConfigService } from "@nestjs/config";
import { TaskStatus } from "../common/task-status";
import { ConversationService } from "../conversation/conversation.service";
import { OrchestrationService } from "../orchestration/orchestration.service";
import { RealtimeService } from "../realtime/realtime.service";
import { TasksService } from "../tasks/tasks.service";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { WebhookAuthService } from "./webhook-auth.service";

describe("ChatController", () => {
  let app: INestApplication;

  const tasksService = {
    createTaskFromUpload: jest.fn(),
    createReasoningTask: jest.fn(),
    getTask: jest.fn(),
    setError: jest.fn(),
    setSegmentationSuccess: jest.fn(),
    setVlmSuccess: jest.fn(),
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

  const configService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        ChatService,
        { provide: TasksService, useValue: tasksService },
        { provide: ConversationService, useValue: conversationService },
        { provide: OrchestrationService, useValue: orchestrationService },
        { provide: RealtimeService, useValue: realtimeService },
        WebhookAuthService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("accepts upload requests and returns the queued task payload", async () => {
    tasksService.createTaskFromUpload.mockResolvedValue({
      job_id: "1d6b58ee-7d34-47a7-8db8-2210b22b9d11",
      session_id: "38a23b6d-655d-4821-b918-6023e3f69c4d",
      image_url: "https://example.com/image.png",
      status: TaskStatus.Queued,
    });

    await request(app.getHttpServer())
      .post("/chat/upload")
      .set("x-client-id", "socket-1")
      .set("x-session-id", "38a23b6d-655d-4821-b918-6023e3f69c4d")
      .field("question", "Assess road access")
      .attach("file", Buffer.from("image-bytes"), "flood.png")
      .expect(201)
      .expect(({ body }) => {
        expect(body.jobId).toBe("1d6b58ee-7d34-47a7-8db8-2210b22b9d11");
        expect(body.reasoningTaskId).toBe(
          "1d6b58ee-7d34-47a7-8db8-2210b22b9d11",
        );
        expect(body.sessionId).toBe("38a23b6d-655d-4821-b918-6023e3f69c4d");
        expect(body.status).toBe(TaskStatus.Queued);
      });

    expect(conversationService.ensureSession).toHaveBeenCalled();
    expect(orchestrationService.triggerSegmentation).toHaveBeenCalled();
  });

  it("returns the persisted status payload for polling", async () => {
    tasksService.getTask.mockResolvedValue({
      job_id: "a4940a91-ea44-448e-9680-6be9203c4f6d",
      session_id: "874ae4ec-a53f-4c20-b6d1-06be17463851",
      status: TaskStatus.SuccessVlm,
      image_url: "https://example.com/image.png",
      mask_all_overlay: "https://example.com/mask.png",
      vlm_analysis: "Flood depth is highest near the south gate.",
      error_code: null,
      error_message: null,
      updated_at: "2026-04-01T10:00:00.000Z",
    });
    conversationService.getSession.mockResolvedValue({
      session_id: "874ae4ec-a53f-4c20-b6d1-06be17463851",
      history: [],
    });

    await request(app.getHttpServer())
      .get("/chat/status/a4940a91-ea44-448e-9680-6be9203c4f6d")
      .expect(200)
      .expect(({ body }) => {
        expect(body.jobId).toBe("a4940a91-ea44-448e-9680-6be9203c4f6d");
        expect(body.sessionId).toBe("874ae4ec-a53f-4c20-b6d1-06be17463851");
        expect(body.status).toBe(TaskStatus.SuccessVlm);
        expect(body.reply).toBe("Flood depth is highest near the south gate.");
        expect(body.session).toEqual(
          expect.objectContaining({
            session_id: "874ae4ec-a53f-4c20-b6d1-06be17463851",
          }),
        );
      });
  });

  it("returns session history with camelCase compatibility fields", async () => {
    conversationService.getSession.mockResolvedValue({
      session_id: "874ae4ec-a53f-4c20-b6d1-06be17463851",
      history_count: 1,
      history: [
        {
          history_id: "hist-1",
          session_id: "874ae4ec-a53f-4c20-b6d1-06be17463851",
          reasoning_task_id: "a4940a91-ea44-448e-9680-6be9203c4f6d",
          role: "assistant",
          content: "Flood depth is highest near the south gate.",
          image_urls: ["https://example.com/mask.png"],
          created_at: "2026-04-01T10:00:00.000Z",
        },
      ],
    });

    await request(app.getHttpServer())
      .get("/chat/sessions/874ae4ec-a53f-4c20-b6d1-06be17463851")
      .expect(200)
      .expect(({ body }) => {
        expect(body.session.sessionId).toBe(
          "874ae4ec-a53f-4c20-b6d1-06be17463851",
        );
        expect(body.session.historyCount).toBe(1);
        expect(body.session.history[0]).toEqual(
          expect.objectContaining({
            historyId: "hist-1",
            sessionId: "874ae4ec-a53f-4c20-b6d1-06be17463851",
            reasoningTaskId: "a4940a91-ea44-448e-9680-6be9203c4f6d",
            imageUrls: ["https://example.com/mask.png"],
            createdAt: "2026-04-01T10:00:00.000Z",
          }),
        );
      });
  });

  it("rejects webhook calls when a configured secret is missing", async () => {
    configService.get.mockImplementation((key: string) =>
      key === "WORKER_WEBHOOK_SECRET" ? "secret-123" : undefined,
    );

    await request(app.getHttpServer())
      .post("/chat/webhook/progress")
      .send({
        job_id: "a4940a91-ea44-448e-9680-6be9203c4f6d",
        progress: 10,
      })
      .expect(401);
  });

  it("accepts webhook calls when the configured secret is provided via query token", async () => {
    configService.get.mockImplementation((key: string) =>
      key === "WORKER_WEBHOOK_SECRET" ? "secret-123" : undefined,
    );

    await request(app.getHttpServer())
      .post("/chat/webhook/progress?token=secret-123")
      .send({
        job_id: "a4940a91-ea44-448e-9680-6be9203c4f6d",
        progress: 10,
      })
      .expect(201);

    expect(realtimeService.sendStatus).toHaveBeenCalled();
  });
});
