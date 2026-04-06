import { HttpModule } from "@nestjs/axios";
import { Module, forwardRef } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { TasksModule } from "../tasks/tasks.module";
import { OrchestrationService } from "./orchestration.service";
import { SegmentationClient } from "./segmentation.client";
import { VlmClient } from "./vlm.client";

@Module({
  imports: [HttpModule, TasksModule, forwardRef(() => RealtimeModule)],
  providers: [SegmentationClient, VlmClient, OrchestrationService],
  exports: [OrchestrationService],
})
export class OrchestrationModule {}
