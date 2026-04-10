import { Global, Module } from "@nestjs/common";
import { SharedDatabaseService } from "./database.service";

@Global()
@Module({
  providers: [SharedDatabaseService],
  exports: [SharedDatabaseService],
})
export class SharedDatabaseModule {}
