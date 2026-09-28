// Render-only helpers: no chrome.* calls, no state of their own — every
// function takes a container element and the data to show, and replaces
// that container's children. Testable/visible against sample data alone,
// per the plan's "panel built first, against sample data" decision.

import type { ClassificationResult, ProfilePreview } from "../lib/types.js";

export type StepStatus = "pending" | "active" | "done" | "error";

export interface StepInfo {
  label: string;
  status: StepStatus;
}

export function renderProfileHeader(container: HTMLElement, profile: ProfilePreview | null): void {
  container.replaceChildren();

  if (!profile || (!profile.name && !profile.headline)) {
    const empty = document.createElement("p");
    empty.className = "profile-empty";
    empty.textContent = "No candidate scanned yet.";
    container.appendChild(empty);
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "card profile-header";

  if (profile.photoUrl) {
    const img = document.createElement("img");
    img.className = "profile-photo";
    img.src = profile.photoUrl;
    img.alt = profile.name ?? "Candidate photo";
    wrapper.appendChild(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "profile-photo-placeholder";
    placeholder.textContent = (profile.name ?? "?").trim().charAt(0).toUpperCase() || "?";
    wrapper.appendChild(placeholder);
  }

  const identity = document.createElement("div");
  identity.className = "profile-identity";

  const name = document.createElement("div");
  name.className = "profile-name";
  name.textContent = profile.name || "Unknown name";
  identity.appendChild(name);

  if (profile.headline) {
    const headline = document.createElement("div");
    headline.className = "profile-headline";
    headline.textContent = profile.headline;
    identity.appendChild(headline);
  }

  if (profile.location) {
    const location = document.createElement("div");
    location.className = "profile-location";
    location.textContent = profile.location;
    identity.appendChild(location);
  }

  if (profile.profileUrl) {
    const link = document.createElement("a");
    link.className = "profile-link";
    link.href = profile.profileUrl;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "View on LinkedIn ↗";
    identity.appendChild(link);
  }

  wrapper.appendChild(identity);
  container.appendChild(wrapper);
}

export function renderStepper(container: HTMLElement, steps: StepInfo[]): void {
  container.replaceChildren();
  if (steps.length === 0) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  container.className = "stepper";

  for (const step of steps) {
    const row = document.createElement("div");
    row.className = `step ${step.status}`;

    const dot = document.createElement("span");
    dot.className = "step-dot";
    dot.textContent = step.status === "done" ? "✓" : step.status === "error" ? "!" : "";

    const label = document.createElement("span");
    label.textContent = step.label;

    row.append(dot, label);
    container.appendChild(row);
  }
}

export type SectionKey = keyof Pick<ProfilePreview, "about" | "experience" | "education" | "skills">;

const SECTION_LABELS: [SectionKey, string][] = [
  ["about", "About"],
  ["experience", "Experience"],
  ["education", "Education"],
  ["skills", "Skills"],
];

// `visibleKeys` = the sections the scan actually reads (main.ts passes the
// enabled steps' keys), so a switched-off step's card doesn't sit there
// permanently empty. Omitted = show every section.
export function renderSections(
  container: HTMLElement,
  profile: ProfilePreview | null,
  visibleKeys?: SectionKey[],
): void {
  container.replaceChildren();
  if (!profile) return;

  container.className = "sections";

  for (const [key, label] of SECTION_LABELS) {
    if (visibleKeys && !visibleKeys.includes(key)) continue;
    const text = profile[key]?.trim();

    const details = document.createElement("details");
    details.className = "card section-card";
    details.open = key === "about";

    const summary = document.createElement("summary");
    summary.textContent = label;
    details.appendChild(summary);

    const body = document.createElement("div");
    if (text) {
      body.className = "section-body";
      body.textContent = text;
    } else {
      body.className = "section-body section-empty";
      body.textContent = "Not captured yet.";
    }
    details.appendChild(body);

    container.appendChild(details);
  }
}

function scoreBarColor(score: number): string {
  if (score >= 0.65) return "var(--success-text)";
  if (score >= 0.35) return "var(--warning-text)";
  return "var(--danger-text)";
}

export function renderResult(container: HTMLElement, result: ClassificationResult): void {
  const badge = document.createElement("div");
  badge.className = `recommendation recommendation-${result.recommendation}`;
  badge.textContent = result.recommendation.toUpperCase();

  const scoreRow = document.createElement("div");
  scoreRow.className = "score-row";
  const scoreLabel = document.createElement("span");
  scoreLabel.textContent = `Composite score: ${result.compositeScore.toFixed(2)}`;
  const confidenceLabel = document.createElement("span");
  confidenceLabel.textContent = `Confidence: ${
    result.compositeConfidence === null ? "n/a" : result.compositeConfidence.toFixed(2)
  }`;
  scoreRow.append(scoreLabel, confidenceLabel);

  const children: HTMLElement[] = [badge, scoreRow];

  if (result.needsReview) {
    const review = document.createElement("div");
    review.className = "review-banner";
    review.textContent = `⚠ Needs review — ${result.reviewReason}`;
    children.push(review);
  }

  for (const [dimensionId, dim] of Object.entries(result.dimensionScores)) {
    const wrapper = document.createElement("div");
    wrapper.className = "dimension";

    const header = document.createElement("div");
    header.className = "dimension-header";
    const name = document.createElement("span");
    name.className = "dim-name";
    name.textContent = dimensionId.replace(/_/g, " ");
    const value = document.createElement("span");
    value.className = "dim-value";
    value.textContent = `${dim.normalizedScore.toFixed(2)} · conf ${dim.confidence.toFixed(2)}`;
    header.append(name, value);

    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.width = `${Math.round(dim.normalizedScore * 100)}%`;
    fill.style.background = scoreBarColor(dim.normalizedScore);
    track.appendChild(fill);

    wrapper.append(header, track);
    children.push(wrapper);
  }

  const rawDetails = document.createElement("details");
  rawDetails.id = "raw-details";
  const rawSummary = document.createElement("summary");
  rawSummary.textContent = "View raw classification result";
  const rawPre = document.createElement("pre");
  rawPre.textContent = JSON.stringify(result, null, 2);
  rawDetails.append(rawSummary, rawPre);
  children.push(rawDetails);

  container.replaceChildren(...children);
  container.hidden = false;
}
