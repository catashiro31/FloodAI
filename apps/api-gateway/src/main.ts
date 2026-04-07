import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json, urlencoded } from "express";
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
  const app = await NestFactory.create(AppModule);

  app.use(json({ limit: "10mb" }));
  app.use(urlencoded({ extended: true, limit: "10mb" }));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

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
