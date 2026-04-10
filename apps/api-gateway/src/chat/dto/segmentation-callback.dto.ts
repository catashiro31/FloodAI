import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from "class-validator";
import { TaskStatus } from "../../common/task-status";

export class SegmentationCallbackDto {
  @IsUUID()
  job_id: string;

  @IsEnum(TaskStatus)
  status: TaskStatus;

  @IsOptional()
  @IsString()
  mask_all_overlay?: string;

  @IsOptional()
  @IsString()
  mask_pure?: string;

  @IsOptional()
  @IsString()
  mask_url?: string;

  @IsOptional()
  @IsObject()
  metrics?: Record<string, any>;

  @IsOptional()
  @IsString()
  error_code?: string;

  @IsOptional()
  @IsString()
  error_message?: string;
}
