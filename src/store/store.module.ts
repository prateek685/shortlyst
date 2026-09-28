import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CandidatesController } from "./candidates.controller";
import { Candidate } from "./entities/candidate.entity";
import { ClassificationResultEntity } from "./entities/classification-result.entity";
import { ResultsService } from "./results.service";

@Module({
  imports: [TypeOrmModule.forFeature([Candidate, ClassificationResultEntity])],
  controllers: [CandidatesController],
  providers: [ResultsService],
  exports: [ResultsService],
})
export class StoreModule {}
