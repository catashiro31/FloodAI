import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Task, TaskStatus } from "./entities/task.entity";
import { Session } from "./entities/session.entity";

@Injectable()
export class TasksRepository {
  constructor(
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    @InjectRepository(Session)
    private readonly sessionRepository: Repository<Session>,
  ) {}

  async createTask(task: Partial<Task>) {
    const newTask = this.taskRepository.create(task);
    return this.taskRepository.save(newTask);
  }

  async getTask(jobId: string): Promise<Task> {
    const task = await this.taskRepository.findOne({ where: { job_id: jobId } });
    if (!task) {
      throw new NotFoundException(`Task ${jobId} not found`);
    }
    return task;
  }

  async updateTask(jobId: string, patch: Partial<Task>) {
    await this.taskRepository.update(jobId, patch);
    return this.getTask(jobId);
  }

  async upsertSession(session: Partial<Session>) {
    // TypeORM doesn't have a direct "upsert" that returns the object easily for all drivers,
    // so we can use save() which handles upsert based on primary key.
    return this.sessionRepository.save(session);
  }

  async getSession(sessionId: string): Promise<Session | null> {
    return this.sessionRepository.findOne({ where: { session_id: sessionId } });
  }

  async listSessions(limit = 50): Promise<Session[]> {
    const cappedLimit = Math.min(Math.max(limit, 1), 200);
    return this.sessionRepository.find({
      order: { updated_at: "DESC" },
      take: cappedLimit,
    });
  }
}
