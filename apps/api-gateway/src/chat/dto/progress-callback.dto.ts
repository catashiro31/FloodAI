import { Type } from "class-transformer";
import { IsNumber, IsOptional, IsUUID, Min } from "class-validator";

export class ProgressCallbackDto {
  @IsUUID()
  session_id: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  progress?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  est_seconds_remaining?: number;
}
