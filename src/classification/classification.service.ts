import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { classifyCandidate } from "../classify/classifyCandidate";
import { classificationInputHash } from "../classify/inputHash";
import { RolesService } from "../requirements/roles.service";
import { InvalidRoleRequirementsError } from "../requirements/validate";
import { ResultsService } from "../store/results.service";
import type { CandidateInput, ClassificationResult } from "../types/candidate";
import { toProfileText } from "../types/candidate";
import type { ClassifyRequestDto } from "./dto/classify-request.dto";

@Injectable()
export class ClassificationService {
  constructor(
    private readonly results: ResultsService,
    private readonly roles: RolesService,
  ) {}

  async classify(request: ClassifyRequestDto): Promise<ClassificationResult> {
    const role = await this.loadRoleOrThrow(request.roleId);
    const candidate = this.resolveProfileText(request.candidate);

    // Same profile text + same role criteria + same model = byte-identical
    // Jev input, so an earlier answer is reused instead of paying for (and
    // waiting on) the same call again. Still upserts the candidate (photo
    // URLs expire, identity fields can change) and still records a result
    // row, so "latest classification" reflects this request.
    const inputHash = classificationInputHash(candidate, role);
    const cached = await this.results.findCachedResult(inputHash);
    const result = cached ?? (await classifyCandidate(candidate, role));

    const candidateRow = await this.results.upsertCandidate(candidate);
    await this.results.insertClassificationResult(candidateRow, role.roleId, result, inputHash);

    return cached ? { ...result, cached: true } : result;
  }

  // profileText is optional on the wire (the LinkedIn extension path only
  // naturally has structuredProfile) but required internally — always derive
  // it here rather than pushing that logic out to every caller.
  private resolveProfileText(
    candidate: ClassifyRequestDto["candidate"],
  ): CandidateInput {
    if (candidate.profileText) {
      return candidate as CandidateInput;
    }
    if (!candidate.structuredProfile) {
      throw new BadRequestException(
        "candidate.profileText is required when structuredProfile is absent",
      );
    }
    return { ...candidate, profileText: toProfileText(candidate.structuredProfile) };
  }

  private async loadRoleOrThrow(roleId: string) {
    try {
      return await this.roles.loadRole(roleId);
    } catch (err) {
      if (err instanceof InvalidRoleRequirementsError) {
        // The role file exists but is misconfigured — a 500-class problem with
        // the server's own data, not something the caller did wrong.
        throw new InternalServerErrorException(
          `Role "${roleId}" is misconfigured: ${err.message}`,
        );
      }
      throw new NotFoundException(`Unknown roleId "${roleId}"`);
    }
  }
}
