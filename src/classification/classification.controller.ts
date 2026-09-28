import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiKeyGuard } from "../common/guards/api-key.guard";
import { ClassificationService } from "./classification.service";
import { ClassifyRequestDto } from "./dto/classify-request.dto";
import type { ClassificationResult } from "../types/candidate";

@Controller()
@UseGuards(ApiKeyGuard)
export class ClassificationController {
  constructor(private readonly classification: ClassificationService) {}

  @Post("classify")
  classify(@Body() body: ClassifyRequestDto): Promise<ClassificationResult> {
    return this.classification.classify(body);
  }
}
