import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import { ChatService } from "../chat/chat.service";
import { CreateChatDto } from "../chat/dto/create-chat.dto";
import { RealtimeService } from "./realtime.service";

@WebSocketGateway({
  cors: {
    origin: "*",
  },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly realtimeService: RealtimeService,
  ) {}

  afterInit(server: Server) {
    this.realtimeService.bindServer(server);
    this.logger.log("Realtime gateway initialized");
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.realtimeService.clearClient(client.id);
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage("registerSession")
  handleRegisterSession(
    @MessageBody() payload: { sessionId?: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (!payload?.sessionId) {
      return;
    }

    this.realtimeService.registerSessionClient(payload.sessionId, client.id);
  }

  @SubscribeMessage("sendMessage")
  async handleMessage(
    @MessageBody() createChatDto: CreateChatDto,
    @ConnectedSocket() client: Socket,
  ) {
    const response = await this.chatService.handleRealtimeMessage(
      createChatDto,
      client.id,
    );

    if (response.reply) {
      this.realtimeService.sendReply(client.id, {
        reply: response.reply,
        imageUrls: response.imageUrls || [],
        jobId: response.jobId,
      });
    }
  }
}
