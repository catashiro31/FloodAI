"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrchestrationModule = void 0;
const axios_1 = require("@nestjs/axios");
const common_1 = require("@nestjs/common");
const realtime_module_1 = require("../realtime/realtime.module");
const tasks_module_1 = require("../tasks/tasks.module");
const orchestration_service_1 = require("./orchestration.service");
const segmentation_client_1 = require("./segmentation.client");
const vlm_client_1 = require("./vlm.client");
let OrchestrationModule = class OrchestrationModule {
};
exports.OrchestrationModule = OrchestrationModule;
exports.OrchestrationModule = OrchestrationModule = __decorate([
    (0, common_1.Module)({
        imports: [axios_1.HttpModule, tasks_module_1.TasksModule, (0, common_1.forwardRef)(() => realtime_module_1.RealtimeModule)],
        providers: [segmentation_client_1.SegmentationClient, vlm_client_1.VlmClient, orchestration_service_1.OrchestrationService],
        exports: [orchestration_service_1.OrchestrationService],
    })
], OrchestrationModule);
//# sourceMappingURL=orchestration.module.js.map