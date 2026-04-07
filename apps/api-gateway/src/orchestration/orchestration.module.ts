import { HttpModule } from "@nestjs/axios";
import { Module, forwardRef } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { TasksModule } from "../tasks/tasks.module";
import { OrchestrationService } from "./orchestration.service";
import { SegmentationClient } from "./segmentation.client";
import { VlmClient } from "./vlm.client";
import { VlmModule } from "../vlm/vlm.module";

@Module({
  imports: [HttpModule, TasksModule, forwardRef(() => RealtimeModule), VlmModule],
  providers: [SegmentationClient, VlmClient, OrchestrationService],
  exports: [OrchestrationService],
})
export class OrchestrationModule {}
