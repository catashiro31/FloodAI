import { CloudinaryService } from "../shared/storage/cloudinary.service";
import { TasksRepository } from "./tasks.repository";
import { Task } from "./entities/task.entity";
interface CreateTaskInput {
    file: Express.Multer.File;
    sessionId: string;
    question?: string;
}
export declare class TasksService {
    private readonly repository;
    private readonly cloudinaryService;
    private readonly logger;
    constructor(repository: TasksRepository, cloudinaryService: CloudinaryService);
    createTaskFromUpload(input: CreateTaskInput): Promise<Task>;
    getTask(jobId: string): Promise<Task>;
    setSegmentationProcessing(jobId: string): Promise<Task>;
    setSegmentationSuccess(jobId: string, maskAllOverlay?: string | null): Promise<Task>;
    setVlmProcessing(jobId: string, question?: string): Promise<Task>;
    setVlmSuccess(jobId: string, reply: string, sessionId: string): Promise<Task>;
    setError(jobId: string, errorCode: string, errorMessage: string): Promise<Task>;
    private transition;
    private resolveFileExtension;
}
export {};
