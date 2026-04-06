import { IsBoolean, IsOptional, IsString, IsUUID } from "class-validator";

export class CreateChatDto {
  @IsString()
  message: string;

  @IsOptional()
  imageUrls?: string[];

  @IsOptional()
  @IsUUID()
  jobId?: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsBoolean()
  reset?: boolean;
}
