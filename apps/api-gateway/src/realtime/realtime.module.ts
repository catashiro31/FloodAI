import { Module, forwardRef } from "@nestjs/common";
import { ChatModule } from "../chat/chat.module";
import { RealtimeGateway } from "./realtime.gateway";
import { RealtimeService } from "./realtime.service";

@Module({
  imports: [forwardRef(() => ChatModule)],
  providers: [RealtimeGateway, RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
