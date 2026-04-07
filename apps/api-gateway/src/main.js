"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const express_1 = require("express");
const app_module_1 = require("./app.module");
function resolveCorsOrigins() {
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
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.use((0, express_1.json)({ limit: "10mb" }));
    app.use((0, express_1.urlencoded)({ extended: true, limit: "10mb" }));
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: false,
    }));
    app.enableCors({
        origin: resolveCorsOrigins(),
        methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
        credentials: false,
    });
    const port = Number(process.env.BACKEND_PORT || process.env.PORT || 5000);
    await app.listen(port);
    console.log(`Backend gateway is running on http://localhost:${port}`);
}
void bootstrap();
//# sourceMappingURL=main.js.map