import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ClassificationModule } from "./classification/classification.module";
import { HealthController } from "./health.controller";
import { MailModule } from "./mail/mail.module";
import { dataSourceOptions } from "./store/data-source";

@Module({
  imports: [TypeOrmModule.forRoot(dataSourceOptions), ClassificationModule, MailModule],
  controllers: [HealthController],
})
export class AppModule {}
