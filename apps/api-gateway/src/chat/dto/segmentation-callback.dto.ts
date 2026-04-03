import { IsOptional, IsString, IsUUID } from "class-validator";

export class SegmentationCallbackDto {
  @IsUUID()
  job_id: string;

  @IsString()
  status: string;

  @IsOptional()
  @IsString()
  mask_all_overlay?: string;

  @IsOptional()
  @IsString()
  mask_url?: string;

  @IsOptional()
  @IsString()
  error_code?: string;

  @IsOptional()
  @IsString()
  error_message?: string;
}
