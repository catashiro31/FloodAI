"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("@nestjs/common");
const testing_1 = require("@nestjs/testing");
const request = require("supertest");
const task_status_1 = require("../common/task-status");
const conversation_service_1 = require("../conversation/conversation.service");
const orchestration_service_1 = require("../orchestration/orchestration.service");
const realtime_service_1 = require("../realtime/realtime.service");
const tasks_service_1 = require("../tasks/tasks.service");
const chat_controller_1 = require("./chat.controller");
const chat_service_1 = require("./chat.service");
describe("ChatController", () => {
    let app;
    const tasksService = {
        createTaskFromUpload: jest.fn(),
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
    beforeEach(async () => {
        jest.clearAllMocks();
        const moduleRef = await testing_1.Test.createTestingModule({
            controllers: [chat_controller_1.ChatController],
            providers: [
                chat_service_1.ChatService,
                { provide: tasks_service_1.TasksService, useValue: tasksService },
                { provide: conversation_service_1.ConversationService, useValue: conversationService },
                { provide: orchestration_service_1.OrchestrationService, useValue: orchestrationService },
                { provide: realtime_service_1.RealtimeService, useValue: realtimeService },
            ],
        }).compile();
        app = moduleRef.createNestApplication();
        app.useGlobalPipes(new common_1.ValidationPipe({
            whitelist: true,
            transform: true,
        }));
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
            status: task_status_1.TaskStatus.Queued,
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
            expect(body.sessionId).toBe("38a23b6d-655d-4821-b918-6023e3f69c4d");
            expect(body.status).toBe(task_status_1.TaskStatus.Queued);
        });
        expect(conversationService.ensureSession).toHaveBeenCalled();
        expect(orchestrationService.triggerSegmentation).toHaveBeenCalled();
    });
    it("returns the persisted status payload for polling", async () => {
        tasksService.getTask.mockResolvedValue({
            job_id: "a4940a91-ea44-448e-9680-6be9203c4f6d",
            session_id: "874ae4ec-a53f-4c20-b6d1-06be17463851",
            status: task_status_1.TaskStatus.SuccessVlm,
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
            expect(body.status).toBe(task_status_1.TaskStatus.SuccessVlm);
            expect(body.reply).toBe("Flood depth is highest near the south gate.");
            expect(body.session).toEqual(expect.objectContaining({
                session_id: "874ae4ec-a53f-4c20-b6d1-06be17463851",
            }));
        });
    });
});
//# sourceMappingURL=chat.controller.spec.js.map