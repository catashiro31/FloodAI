import { Repository } from "typeorm";
import { Task } from "./entities/task.entity";
import { Session } from "./entities/session.entity";
export declare class TasksRepository {
    private readonly taskRepository;
    private readonly sessionRepository;
    constructor(taskRepository: Repository<Task>, sessionRepository: Repository<Session>);
    createTask(task: Partial<Task>): Promise<Task>;
    getTask(jobId: string): Promise<Task>;
    updateTask(jobId: string, patch: Partial<Task>): Promise<Task>;
    upsertSession(session: Partial<Session>): Promise<Partial<Session> & Session>;
    getSession(sessionId: string): Promise<Session | null>;
    listSessions(limit?: number): Promise<Session[]>;
}
