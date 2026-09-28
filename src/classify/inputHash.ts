import { createHash } from "node:crypto";
import type { RoleRequirements } from "../requirements/types";
import type { CandidateInput } from "../types/candidate";
import { buildQuestions, selectState } from "./buildQuestions";

/**
 * Fingerprint of exactly what a Jev call would receive — model, state and
 * questions. Two requests with the same hash would send Jev byte-identical
 * input, so the earlier result can be reused. Any change to the profile text,
 * the role's criteria/weights/levels, or the model produces a new hash.
 *
 * Thresholds aren't part of Jev's input, but they do change the composed
 * recommendation — included so re-tuning a threshold never serves a stale
 * recommendation from cache.
 */
export function classificationInputHash(candidate: CandidateInput, role: RoleRequirements): string {
  const payload = JSON.stringify({
    model: process.env.JEV_MODEL_ID ?? "typesafe/jev-1.13",
    state: selectState(candidate),
    questions: buildQuestions(role),
    thresholds: role.thresholds,
  });
  return createHash("sha256").update(payload).digest("hex");
}
