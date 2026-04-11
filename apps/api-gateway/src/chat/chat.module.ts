import { Module, forwardRef } from "@nestjs/common";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { TasksModule } from "../tasks/tasks.module";
import { ConversationModule } from "../conversation/conversation.module";
import { OrchestrationModule } from "../orchestration/orchestration.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { WebhookAuthService } from "./webhook-auth.service";

@Module({
  imports: [
    TasksModule,
    ConversationModule,
    forwardRef(() => OrchestrationModule),
    forwardRef(() => RealtimeModule),
  ],
  controllers: [ChatController],
  providers: [ChatService, WebhookAuthService],
  exports: [ChatService],
})
export class ChatModule {}
