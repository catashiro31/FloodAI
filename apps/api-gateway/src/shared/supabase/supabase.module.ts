import { Global, Module } from "@nestjs/common";
import { SharedSupabaseService } from "./supabase.service";

@Global()
@Module({
  providers: [SharedSupabaseService],
  exports: [SharedSupabaseService],
})
export class SharedSupabaseModule {}
