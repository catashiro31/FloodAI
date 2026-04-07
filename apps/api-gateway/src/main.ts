import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { json, urlencoded } from "express";
import * as path from "path";
import { AppModule } from "./app.module";

function resolveCorsOrigins(): true | string[] {
  const configuredOrigins = process.env.CORS_ORIGIN;

  if (!configuredOrigins) {
    return true;
  }

  const origins = configuredOrigins
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return origins.length > 0 ? origins : true;
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.use(json({ limit: "50mb" }));
  app.use(urlencoded({ extended: true, limit: "50mb" }));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  // Phục vụ ảnh cục bộ từ thư mục uploads/
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  app.useStaticAssets(uploadsDir, { prefix: "/static" });

  app.enableCors({
    origin: resolveCorsOrigins(),
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    credentials: false,
  });

  const port = Number(process.env.BACKEND_PORT || process.env.PORT || 5000);
  await app.listen(port);
  console.log(`🚀 Backend gateway is running on http://localhost:${port}`);
}
void bootstrap();

