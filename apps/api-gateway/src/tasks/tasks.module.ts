import { Module } from "@nestjs/common";
import { SharedDatabaseModule } from "../shared/database/database.module";
import { SharedStorageModule } from "../shared/storage/storage.module";
import { TasksRepository } from "./tasks.repository";
import { TasksService } from "./tasks.service";

@Module({
  imports: [SharedDatabaseModule, SharedStorageModule],
  providers: [TasksRepository, TasksService],
  exports: [TasksRepository, TasksService],
})
export class TasksModule {}
