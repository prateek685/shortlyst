import { Module } from "@nestjs/common";
import { RequirementsModule } from "../requirements/requirements.module";
import { StoreModule } from "../store/store.module";
import { ClassificationController } from "./classification.controller";
import { ClassificationService } from "./classification.service";
import { RolesController } from "./roles.controller";

@Module({
  imports: [StoreModule, RequirementsModule],
  controllers: [ClassificationController, RolesController],
  providers: [ClassificationService],
  exports: [ClassificationService],
})
export class ClassificationModule {}
