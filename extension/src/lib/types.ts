// Mirrors profile-classification/src/types/candidate.ts by hand — not shared
// via a workspace package (kept as a deliberately simple, rarely-changing
// data shape rather than adding build tooling for this). Keep in sync
// manually if the backend's shapes change.
//
// structuredProfile is intentionally omitted — this extension sends raw
// page text as profileText only (see the plan's "Raw text, not structured
// fields" decision).

export interface CandidateInput {
  externalId?: string;
  source: "manual" | "linkedin" | "email";
  profileText: string;
  // Display-only identity — never sent to Jev, persisted purely so a later
  // "export the current shortlist" action has something to show beyond a
  // bare LinkedIn URL.
  name?: string;
  headline?: string;
  location?: string;
  photoUrl?: string;
}

export interface DimensionScoreResult {
  rawScore: number;
  normalizedScore: number;
  confidence: number;
  weight: number;
}

export type Recommendation = "contact" | "maybe" | "reject";

export interface ClassificationResult {
  recommendation: Recommendation;
  compositeScore: number;
  compositeConfidence: number | null;
  dimensionScores: Record<string, DimensionScoreResult>;
  needsReview: boolean;
  reviewReason: string | null;
  rawAnswers: Record<string, unknown>;
}

export interface RoleSummary {
  roleId: string;
}

// Mirrors the backend's GET /candidates/shortlisted response shape —
// each candidate's most recent classification only, already filtered to
// recommendation = contact.
export interface ShortlistedCandidate {
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

export interface RoleImportSummary {
  imported: string[];
  skipped: { roleId: string; reason: string }[];
}

// Mirrors the backend's src/requirements/types.ts — the GET /roles/:roleId
// response shape, for the Roles detail view.
export interface RoleDimension {
  id: string;
  instructions: string;
  weight: number;
  levels: string[];
}

export interface RoleMustHave {
  id: string;
  instructions: string;
}

export interface RoleThresholds {
  contact: number;
  reject: number;
  confidenceFloor: number;
}

export interface RoleRequirements {
  roleId: string;
  dimensions: RoleDimension[];
  mustHaves: RoleMustHave[];
  thresholds: RoleThresholds;
}

// Display-only shape for the side panel — never sent to the backend as-is
// (its fields get flattened into CandidateInput.profileText instead).
export interface ProfilePreview {
  name?: string;
  headline?: string;
  location?: string;
  photoUrl?: string;
  profileUrl: string;
  about: string;
  experience: string;
  education: string;
  skills: string;
}
