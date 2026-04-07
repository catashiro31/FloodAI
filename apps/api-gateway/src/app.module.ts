import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ChatModule } from "./chat/chat.module";
import { ConversationModule } from "./conversation/conversation.module";
import { OrchestrationModule } from "./orchestration/orchestration.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { TasksModule } from "./tasks/tasks.module";
import { VlmModule } from "./vlm/vlm.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: "postgres",
        host: configService.get<string>("DB_HOST"),
        port: configService.get<number>("DB_PORT"),
        username: configService.get<string>("DB_USER"),
        password: configService.get<string>("DB_PASSWORD"),
        database: configService.get<string>("DB_NAME"),
        autoLoadEntities: true,
        synchronize: false, // Sử dụng schema.sql đã chạy
      }),
    }),
    TasksModule,
    ConversationModule,
    OrchestrationModule,
    ChatModule,
    RealtimeModule,
    VlmModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
