import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ClassificationModule } from "../classification/classification.module";
import { RequirementsModule } from "../requirements/requirements.module";
import { MailConnectionEntity } from "./entities/mail-connection.entity";
import { MailMessageEntity } from "./entities/mail-message.entity";
import { MailThreadEntity } from "./entities/mail-thread.entity";
import { MailTriageResultEntity } from "./entities/mail-triage-result.entity";
import { MailProcessService } from "./mail-process.service";
import { MailQueueService } from "./mail-queue.service";
import { MailSyncService } from "./mail-sync.service";
import { MailWorkers } from "./mail-workers";
import { MailController } from "./mail.controller";
import { MailStore } from "./mail.store";
import { TriageService } from "./triage.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([MailConnectionEntity, MailThreadEntity, MailMessageEntity, MailTriageResultEntity]),
    ClassificationModule,
    RequirementsModule,
  ],
  controllers: [MailController],
  providers: [MailStore, TriageService, MailQueueService, MailSyncService, MailProcessService, MailWorkers],
})
export class MailModule {}
