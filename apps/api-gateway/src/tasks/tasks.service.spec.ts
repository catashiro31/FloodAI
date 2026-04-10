import { Test } from "@nestjs/testing";
import { TaskStatus } from "../common/task-status";
import { SharedStorageService } from "../shared/storage/storage.service";
import { ImageTaskRecord, ReasoningTaskRecord } from "./task.types";
import { TasksRepository } from "./tasks.repository";
import { TasksService } from "./tasks.service";

describe("TasksService", () => {
  let service: TasksService;

  const repository = {
    createImageTask: jest.fn(),
    createReasoningTask: jest.fn(),
    getReasoningTask: jest.fn(),
    getImageTask: jest.fn(),
    getLatestImageTaskBySession: jest.fn(),
    listImageTasksBySession: jest.fn(),
    listReasoningTasksBySession: jest.fn(),
    updateImageTask: jest.fn(),
    updateReasoningTask: jest.fn(),
  };

  const storageService = {
    findFile: jest.fn(),
    buildStoragePath: jest.fn(),
    getPublicUrl: jest.fn(),
    ensureFile: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: TasksRepository, useValue: repository },
        { provide: SharedStorageService, useValue: storageService },
      ],
    }).compile();

    service = moduleRef.get(TasksService);
  });

  it("reuses existing storage file public url when the image already exists", async () => {
    storageService.findFile.mockResolvedValue([{ name: "abc.png" }]);
    storageService.buildStoragePath.mockReturnValue("originals/abc.png");
    storageService.getPublicUrl.mockReturnValue("https://cdn.example.com/abc");

    repository.getReasoningTask.mockResolvedValue(
      buildReasoningTask("job-1", "session-1"),
    );
    repository.getImageTask.mockResolvedValue(
      buildImageTask("job-1", "session-1", "https://cdn.example.com/abc"),
    );

    const result = await service.createTaskFromUpload({
      file: {
        buffer: Buffer.from("image-bytes"),
        mimetype: "image/png",
      } as Express.Multer.File,
      sessionId: "session-1",
      question: "flood?",
    });

    expect(storageService.findFile).toHaveBeenCalledWith(
      expect.stringMatching(/\.png$/),
    );
    expect(storageService.ensureFile).not.toHaveBeenCalled();
    expect(storageService.getPublicUrl).toHaveBeenCalledWith(
      "originals/abc.png",
    );
    expect(repository.createImageTask).toHaveBeenCalledWith(
      expect.objectContaining({
        job_id: expect.any(String),
        session_id: "session-1",
        image_url: "https://cdn.example.com/abc",
        status: TaskStatus.Queued,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        job_id: "job-1",
        session_id: "session-1",
        image_url: "https://cdn.example.com/abc",
      }),
    );
  });

  it("uploads a new storage file and persists its public url when the image is new", async () => {
    storageService.findFile.mockResolvedValue([]);
    storageService.buildStoragePath.mockReturnValue("originals/def.png");
    storageService.ensureFile.mockResolvedValue("https://cdn.example.com/def");

    repository.getReasoningTask.mockResolvedValue(
      buildReasoningTask("job-2", "session-2"),
    );
    repository.getImageTask.mockResolvedValue(
      buildImageTask("job-2", "session-2", "https://cdn.example.com/def"),
    );

    const fileBuffer = Buffer.from("new-image");
    const result = await service.createTaskFromUpload({
      file: {
        buffer: fileBuffer,
        mimetype: "image/png",
      } as Express.Multer.File,
      sessionId: "session-2",
      question: "where is the flooding?",
    });

    expect(storageService.getPublicUrl).not.toHaveBeenCalled();
    expect(storageService.ensureFile).toHaveBeenCalledWith(
      "originals/def.png",
      fileBuffer,
      "image/png",
    );
    expect(repository.createImageTask).toHaveBeenCalledWith(
      expect.objectContaining({
        job_id: expect.any(String),
        session_id: "session-2",
        image_url: "https://cdn.example.com/def",
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        job_id: "job-2",
        session_id: "session-2",
        image_url: "https://cdn.example.com/def",
      }),
    );
  });

  it("keeps image snapshots isolated per job when a session has multiple uploads", async () => {
    repository.listReasoningTasksBySession.mockResolvedValue([
      buildReasoningTask("job-2", "session-1"),
      buildReasoningTask("job-1", "session-1"),
    ]);
    repository.listImageTasksBySession.mockResolvedValue([
      buildImageTask("job-1", "session-1", "https://cdn.example.com/original"),
      {
        ...buildImageTask("job-2", "session-1", "https://cdn.example.com/new"),
        mask_all_overlay: "https://cdn.example.com/new-mask",
      },
    ]);

    const result = await service.getTasksBySession("session-1");

    expect(result).toEqual([
      expect.objectContaining({
        job_id: "job-2",
        image_url: "https://cdn.example.com/new",
        mask_all_overlay: "https://cdn.example.com/new-mask",
      }),
      expect.objectContaining({
        job_id: "job-1",
        image_url: "https://cdn.example.com/original",
        mask_all_overlay: null,
      }),
    ]);
  });
});

function buildReasoningTask(
  jobId: string,
  sessionId: string,
): ReasoningTaskRecord {
  return {
    job_id: jobId,
    session_id: sessionId,
    status: TaskStatus.Queued,
    question: null,
    vlm_analysis: null,
    error_code: null,
    error_message: null,
    vlm_callback_at: null,
    created_at: "2026-04-11T00:00:00.000Z",
    updated_at: "2026-04-11T00:00:00.000Z",
  };
}

function buildImageTask(
  jobId: string,
  sessionId: string,
  imageUrl: string,
): ImageTaskRecord {
  return {
    job_id: jobId,
    session_id: sessionId,
    image_url: imageUrl,
    status: TaskStatus.Queued,
    mask_all_overlay: null,
    metrics: null,
    error_code: null,
    error_message: null,
    segmentation_callback_at: null,
    created_at: "2026-04-11T00:00:00.000Z",
    updated_at: "2026-04-11T00:00:00.000Z",
  };
}
