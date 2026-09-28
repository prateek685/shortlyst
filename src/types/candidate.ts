export interface LinkedInExperienceEntry {
  title: string;
  company: string;
  duration?: string;
  description?: string;
}

export interface LinkedInEducationEntry {
  school: string;
  degree?: string;
  dates?: string;
}

export interface LinkedInProfileData {
  profileUrl: string;
  headline?: string;
  location?: string;
  about?: string;
  experience: LinkedInExperienceEntry[];
  education?: LinkedInEducationEntry[];
  skills?: string[];
}

export interface CandidateInput {
  /** email, LinkedIn URL, or other stable identity — used for Postgres dedup */
  externalId?: string;
  source: "manual" | "linkedin" | "email";
  /** always populated — flattened, human-readable text for storage/audit/display */
  profileText: string;
  /** present only for the LinkedIn path; sent to Jev as `state` when present */
  structuredProfile?: LinkedInProfileData;
  /** display-only identity, scraped by the extension — never sent to Jev,
   * persisted purely so a later "export the current shortlist" action has
   * something to show beyond a bare LinkedIn URL */
  name?: string;
  headline?: string;
  location?: string;
  photoUrl?: string;
}

export interface DimensionScoreResult {
  /** raw Jev score, position across the role's ordered levels */
  rawScore: number;
  /** normalized to 0-1 */
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
  /** full Jev response, kept for audit (incl. usage.cost and request id) */
  rawAnswers: Record<string, unknown>;
  /** true when this result was reused from an identical earlier request (no Jev call made) */
  cached?: boolean;
}

/**
 * Derives a flattened, human-readable profile text from a structured LinkedIn
 * scrape, so `profile_text` stays populated regardless of source.
 */
export function toProfileText(profile: LinkedInProfileData): string {
  const lines: string[] = [];

  if (profile.headline) lines.push(profile.headline);
  if (profile.location) lines.push(profile.location);
  if (profile.about) lines.push("", "About:", profile.about);

  if (profile.experience.length > 0) {
    lines.push("", "Experience:");
    for (const entry of profile.experience) {
      const header = [entry.title, entry.company].filter(Boolean).join(" at ");
      const duration = entry.duration ? ` (${entry.duration})` : "";
      lines.push(`- ${header}${duration}`);
      if (entry.description) lines.push(`  ${entry.description}`);
    }
  }

  if (profile.education?.length) {
    lines.push("", "Education:");
    for (const entry of profile.education) {
      const header = [entry.degree, entry.school].filter(Boolean).join(", ");
      const dates = entry.dates ? ` (${entry.dates})` : "";
      lines.push(`- ${header}${dates}`);
    }
  }

  if (profile.skills?.length) {
    lines.push("", "Skills:", profile.skills.join(", "));
  }

  return lines.join("\n").trim();
}
