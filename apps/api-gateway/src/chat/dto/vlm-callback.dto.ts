import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from "class-validator";
import { SessionHistoryItem } from "../../tasks/task.types";

export class VlmCallbackDto {
  @IsUUID()
  job_id: string;

  @IsUUID()
  session_id: string;

  @IsString()
  status: string;

  @IsOptional()
  @IsString()
  reply?: string;

  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  history?: SessionHistoryItem[];

  @IsOptional()
  @IsString()
  error_code?: string;

  @IsOptional()
  @IsString()
  error_message?: string;
}
