import { IsOptional, IsString, IsUUID } from "class-validator";

export class UploadChatDto {
  @IsOptional()
  @IsString()
  question?: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;
}
