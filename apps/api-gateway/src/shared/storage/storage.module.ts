import { Global, Module } from "@nestjs/common";
import { SharedStorageService } from "./storage.service";

@Global()
@Module({
  providers: [SharedStorageService],
  exports: [SharedStorageService],
})
export class SharedStorageModule {}
