import { Module } from '@nestjs/common';
import { VlmService } from './vlm.service';

@Module({
  providers: [VlmService],
  exports: [VlmService],
})
export class VlmModule {}
