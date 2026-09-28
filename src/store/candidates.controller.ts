import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiKeyGuard } from "../common/guards/api-key.guard";
import { ResultsService, ShortlistedCandidateRow } from "./results.service";

@Controller()
@UseGuards(ApiKeyGuard)
export class CandidatesController {
  constructor(private readonly results: ResultsService) {}

  @Get("candidates")
  listAll(): Promise<ShortlistedCandidateRow[]> {
    return this.results.listAllCandidates();
  }

  @Get("candidates/shortlisted")
  listShortlisted(): Promise<ShortlistedCandidateRow[]> {
    return this.results.listShortlistedCandidates();
  }
}
