import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ChatModule } from "./chat/chat.module";
import { ConversationModule } from "./conversation/conversation.module";
import { OrchestrationModule } from "./orchestration/orchestration.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { SharedSupabaseModule } from "./shared/supabase/supabase.module";
import { TasksModule } from "./tasks/tasks.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SharedSupabaseModule,
    TasksModule,
    ConversationModule,
    OrchestrationModule,
    ChatModule,
    RealtimeModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
