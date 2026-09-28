import { Injectable } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { Candidate } from "./entities/candidate.entity";
import { ClassificationResultEntity } from "./entities/classification-result.entity";
import type { CandidateInput, ClassificationResult, Recommendation } from "../types/candidate";

// LinkedInProfileData is a plain JSON-serializable shape but has no index
// signature, so it isn't structurally assignable to the jsonb column's
// Record<string, unknown> type — this cast is safe, not a type escape hatch
// around a real mismatch.
function toJsonbColumn(
  profile: CandidateInput["structuredProfile"],
): Record<string, unknown> | null {
  return profile ? (profile as unknown as Record<string, unknown>) : null;
}

@Injectable()
export class ResultsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Candidate)
    private readonly candidates: Repository<Candidate>,
    @InjectRepository(ClassificationResultEntity)
    private readonly results: Repository<ClassificationResultEntity>,
  ) {}

  // Upserts by external_id when present (dedup); otherwise always inserts a new
  // candidate row (no stable identity was given to dedup against).
  async upsertCandidate(candidate: CandidateInput): Promise<Candidate> {
    if (candidate.externalId) {
      const existing = await this.candidates.findOne({
        where: { externalId: candidate.externalId },
      });
      if (existing) {
        existing.profileText = candidate.profileText;
        existing.structuredProfile = toJsonbColumn(candidate.structuredProfile);
        existing.source = candidate.source;
        existing.name = candidate.name ?? null;
        existing.headline = candidate.headline ?? null;
        existing.location = candidate.location ?? null;
        existing.photoUrl = candidate.photoUrl ?? null;
        return this.candidates.save(existing);
      }
    }

    return this.candidates.save(
      this.candidates.create({
        externalId: candidate.externalId ?? null,
        source: candidate.source,
        profileText: candidate.profileText,
        structuredProfile: toJsonbColumn(candidate.structuredProfile),
        name: candidate.name ?? null,
        headline: candidate.headline ?? null,
        location: candidate.location ?? null,
        photoUrl: candidate.photoUrl ?? null,
      }),
    );
  }

  async insertClassificationResult(
    candidate: Candidate,
    roleId: string,
    result: ClassificationResult,
    inputHash: string,
  ): Promise<ClassificationResultEntity> {
    return this.results.save(
      this.results.create({
        candidate,
        roleId,
        dimensionScores: result.dimensionScores,
        compositeScore: result.compositeScore,
        compositeConfidence: result.compositeConfidence,
        recommendation: result.recommendation,
        needsReview: result.needsReview,
        reviewReason: result.reviewReason ?? null,
        rawAnswers: result.rawAnswers,
        inputHash,
      }),
    );
  }

  // Most recent earlier result for this exact Jev input, if any. Matched on
  // hash alone (not candidate): the hash already covers the full profile
  // text, so a match is by definition the same input regardless of which
  // row it was stored under.
  async findCachedResult(inputHash: string): Promise<ClassificationResult | null> {
    const row = await this.results.findOne({
      where: { inputHash },
      order: { createdAt: "DESC" },
    });
    if (!row) return null;
    // numeric columns come back from the pg driver as strings
    return {
      recommendation: row.recommendation,
      compositeScore: Number(row.compositeScore),
      compositeConfidence: row.compositeConfidence === null ? null : Number(row.compositeConfidence),
      dimensionScores: row.dimensionScores as ClassificationResult["dimensionScores"],
      needsReview: row.needsReview,
      reviewReason: row.reviewReason,
      rawAnswers: row.rawAnswers,
    };
  }

  // Each candidate's MOST RECENT classification only — a candidate
  // reclassified since drops/updates rather than a stale older result
  // lingering. A LATERAL join is the natural fit for "latest row per group"
  // in Postgres; TypeORM's query builder doesn't express that cleanly,
  // hence raw SQL. `onlyContact` is the one thing that varies between the
  // two public methods below.
  private async queryCandidatesWithLatestResult(onlyContact: boolean): Promise<ShortlistedCandidateRow[]> {
    const rows = await this.dataSource.query<RawShortlistedRow[]>(`
      select c.id as "candidateId", c.name, c.headline, c.location,
             c.external_id as "linkedinUrl", c.photo_url as "photoUrl",
             r.role_id as "roleId", r.composite_score as "compositeScore",
             r.composite_confidence as "compositeConfidence",
             r.recommendation, r.needs_review as "needsReview",
             r.review_reason as "reviewReason", r.created_at as "classifiedAt"
      from candidates c
      join lateral (
        select * from classification_results cr
        where cr.candidate_id = c.id
        order by cr.created_at desc
        limit 1
      ) r on true
      ${onlyContact ? `where r.recommendation = 'contact'` : ""}
      order by r.created_at desc
    `);

    // numeric/timestamptz columns come back from the pg driver as strings —
    // deliberate Number()/toISOString() conversions below, not stray casts.
    return rows.map((row) => ({
      candidateId: row.candidateId,
      name: row.name,
      headline: row.headline,
      location: row.location,
      linkedinUrl: row.linkedinUrl,
      photoUrl: row.photoUrl,
      roleId: row.roleId,
      compositeScore: Number(row.compositeScore),
      compositeConfidence: row.compositeConfidence === null ? null : Number(row.compositeConfidence),
      recommendation: row.recommendation as Recommendation,
      needsReview: row.needsReview,
      reviewReason: row.reviewReason,
      classifiedAt: new Date(row.classifiedAt).toISOString(),
    }));
  }

  /** Every candidate whose most recent classification is "contact" — a
   * candidate later reclassified away from contact drops out. */
  listShortlistedCandidates(): Promise<ShortlistedCandidateRow[]> {
    return this.queryCandidatesWithLatestResult(true);
  }

  /** Every candidate, any recommendation — each still only their most
   * recent classification. */
  listAllCandidates(): Promise<ShortlistedCandidateRow[]> {
    return this.queryCandidatesWithLatestResult(false);
  }
}

interface RawShortlistedRow {
  candidateId: string;
  name: string | null;
  headline: string | null;
  location: string | null;
  linkedinUrl: string | null;
  photoUrl: string | null;
  roleId: string;
  compositeScore: string;
  compositeConfidence: string | null;
  recommendation: string;
  needsReview: boolean;
  reviewReason: string | null;
  classifiedAt: string | Date;
}

export interface ShortlistedCandidateRow {
  candidateId: string;
  name: string | null;
  headline: string | null;
  location: string | null;
  linkedinUrl: string | null;
  photoUrl: string | null;
  roleId: string;
  compositeScore: number;
  compositeConfidence: number | null;
  recommendation: Recommendation;
  needsReview: boolean;
  reviewReason: string | null;
  classifiedAt: string;
}
