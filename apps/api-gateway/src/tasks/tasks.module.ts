import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { TasksRepository } from "./tasks.repository";
import { TasksService } from "./tasks.service";
import { Task } from "./entities/task.entity";
import { Session } from "./entities/session.entity";
import { StorageModule } from "../shared/storage/storage.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([Task, Session]),
    StorageModule,
  ],
  providers: [TasksRepository, TasksService],
  exports: [TasksRepository, TasksService],
})
export class TasksModule {}
