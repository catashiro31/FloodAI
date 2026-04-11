import {
  IsArray,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from "class-validator";
import { TaskStatus } from "../../common/task-status";
import { SessionHistoryRecord } from "../../tasks/task.types";

export class VlmCallbackDto {
  @IsUUID()
  job_id: string;

  @IsUUID()
  @IsOptional()
  session_id?: string;

  @IsEnum(TaskStatus)
  status: TaskStatus;

  @IsOptional()
  @IsString()
  reply?: string;

  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  history?: SessionHistoryRecord[];

  @IsOptional()
  @IsString()
  error_code?: string;

  @IsOptional()
  @IsString()
  error_message?: string;
}
