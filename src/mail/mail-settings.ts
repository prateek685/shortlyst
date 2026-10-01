import type { Outcome } from "./provider";

// MAIL_TAG_NOT_CANDIDATE=true brings back the "Not a candidate" tag; off by
// default so newsletters and vendor mail stay untouched in HR's inbox.
export function tagNotCandidate(): boolean {
  return process.env.MAIL_TAG_NOT_CANDIDATE === "true";
}

/** The outcomes that get a tag in the mailbox. */
export function taggedOutcomes(): Outcome[] {
  const outcomes: Outcome[] = ["contact", "maybe", "reject", "needs_review"];
  return tagNotCandidate() ? [...outcomes, "not_candidate"] : outcomes;
}
