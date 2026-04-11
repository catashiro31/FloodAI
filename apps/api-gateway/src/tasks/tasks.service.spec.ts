import { ConflictException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { TaskStatus } from "../common/task-status";
import { SharedStorageService } from "../shared/storage/storage.service";
import { ImageTaskRecord, ReasoningTaskRecord } from "./task.types";
import { TasksRepository } from "./tasks.repository";
import { TasksService } from "./tasks.service";

describe("TasksService", () => {
  let service: TasksService;

  const repository = {
    createReasoningTask: jest.fn(),
    getReasoningTask: jest.fn(),
    getLatestImageTaskBySession: jest.fn(),
    getLatestReasoningTaskByStatuses: jest.fn(),
    listReasoningTasksBySession: jest.fn(),
    updateImageTask: jest.fn(),
    updateReasoningTask: jest.fn(),
    upsertImageTask: jest.fn(),
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
    repository.getLatestImageTaskBySession
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        buildImageTask("session-1", "https://cdn.example.com/abc"),
      );
    repository.getReasoningTask.mockResolvedValue(
      buildReasoningTask("job-1", "session-1", "https://cdn.example.com/abc"),
    );

    const result = await service.createTaskFromUpload({
      file: {
        buffer: Buffer.from("image-bytes"),
        mimetype: "image/png",
      } as Express.Multer.File,
      sessionId: "session-1",
      question: "flood?",
    });

    expect(storageService.ensureFile).not.toHaveBeenCalled();
    expect(repository.createReasoningTask).toHaveBeenCalledWith(
      expect.objectContaining({
        job_id: expect.any(String),
        session_id: "session-1",
        image_url: "https://cdn.example.com/abc",
      }),
    );
    expect(repository.upsertImageTask).toHaveBeenCalledWith(
      expect.objectContaining({
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
    repository.getLatestImageTaskBySession
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        buildImageTask("session-2", "https://cdn.example.com/def"),
      );
    repository.getReasoningTask.mockResolvedValue(
      buildReasoningTask("job-2", "session-2", "https://cdn.example.com/def"),
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

    expect(storageService.ensureFile).toHaveBeenCalledWith(
      "originals/def.png",
      fileBuffer,
      "image/png",
    );
    expect(repository.upsertImageTask).toHaveBeenCalledWith(
      expect.objectContaining({
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

  it("rejects a second image upload for the same session", async () => {
    repository.getLatestImageTaskBySession.mockResolvedValue(
      buildImageTask("session-1", "https://cdn.example.com/existing"),
    );

    await expect(
      service.createTaskFromUpload({
        file: {
          buffer: Buffer.from("image-bytes"),
          mimetype: "image/png",
        } as Express.Multer.File,
        sessionId: "session-1",
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(repository.createReasoningTask).not.toHaveBeenCalled();
    expect(repository.upsertImageTask).not.toHaveBeenCalled();
  });

  it("creates follow-up reasoning tasks without cloning image rows", async () => {
    repository.getLatestImageTaskBySession
      .mockResolvedValueOnce(
        buildImageTask(
          "session-1",
          "https://cdn.example.com/original",
          "https://cdn.example.com/mask",
        ),
      )
      .mockResolvedValueOnce(
        buildImageTask(
          "session-1",
          "https://cdn.example.com/original",
          "https://cdn.example.com/mask",
        ),
      );
    repository.getReasoningTask.mockResolvedValue(
      buildReasoningTask(
        "job-3",
        "session-1",
        "https://cdn.example.com/original",
        "https://cdn.example.com/mask",
      ),
    );

    const result = await service.createReasoningTask(
      "session-1",
      "Can you focus on the eastern bridge?",
    );

    expect(repository.createReasoningTask).toHaveBeenCalledWith(
      expect.objectContaining({
        job_id: expect.any(String),
        session_id: "session-1",
        image_url: "https://cdn.example.com/original",
        mask_url: "https://cdn.example.com/mask",
      }),
    );
    expect(repository.upsertImageTask).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        job_id: "job-3",
        mask_all_overlay: "https://cdn.example.com/mask",
      }),
    );
  });
});

function buildReasoningTask(
  jobId: string,
  sessionId: string,
  imageUrl: string,
  maskUrl: string | null = null,
): ReasoningTaskRecord {
  return {
    job_id: jobId,
    session_id: sessionId,
    status: TaskStatus.Queued,
    question: null,
    image_url: imageUrl,
    mask_url: maskUrl,
    vlm_analysis: null,
    error_code: null,
    error_message: null,
    vlm_callback_at: null,
    created_at: "2026-04-11T00:00:00.000Z",
    updated_at: "2026-04-11T00:00:00.000Z",
  };
}

function buildImageTask(
  sessionId: string,
  imageUrl: string,
  maskUrl: string | null = null,
): ImageTaskRecord {
  return {
    session_id: sessionId,
    image_url: imageUrl,
    status: maskUrl ? TaskStatus.SuccessSegmentation : TaskStatus.Queued,
    mask_url: maskUrl,
    metrics: null,
    error_code: null,
    error_message: null,
    segmentation_callback_at: null,
    created_at: "2026-04-11T00:00:00.000Z",
    updated_at: "2026-04-11T00:00:00.000Z",
  };
}
