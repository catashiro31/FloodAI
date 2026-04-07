import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit } from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { ChatService } from "../chat/chat.service";
import { CreateChatDto } from "../chat/dto/create-chat.dto";
import { RealtimeService } from "./realtime.service";
export declare class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    private readonly chatService;
    private readonly realtimeService;
    server: Server;
    private readonly logger;
    constructor(chatService: ChatService, realtimeService: RealtimeService);
    afterInit(server: Server): void;
    handleConnection(client: Socket): void;
    handleDisconnect(client: Socket): void;
    handleRegisterSession(payload: {
        sessionId?: string;
    }, client: Socket): void;
    handleMessage(createChatDto: CreateChatDto, client: Socket): Promise<void>;
}
