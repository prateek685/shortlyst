import type { NoulResponse, ScoreResponse } from "@typesafe-ai/sdk";
import type { RoleRequirements } from "../requirements/types";
import type {
  ClassificationResult,
  DimensionScoreResult,
  Recommendation,
} from "../types/candidate";
import { INJECTION_RISK_QUESTION_ID } from "./buildQuestions";

const INJECTION_RISK_THRESHOLD = 0.5;

export type AnswersMap = Record<string, ScoreResponse | NoulResponse>;

/**
 * Noul has no separate confidence field — the probability itself carries the
 * signal, and a value near 0.5 means genuine uncertainty, not "medium". This
 * derives a 0-1 confidence from distance to 0.5 so must-haves and the
 * injection check can participate in the same confidence-floor gate as scores.
 */
function noulConfidence(noulProbability: number): number {
  return Math.abs(noulProbability - 0.5) * 2;
}

/**
 * Normalizes raw answers into a weighted composite score, a recommendation
 * bucket, and needsReview flags — all computed in code, never by asking Jev
 * for the final verdict, so weights stay adjustable without re-running inference.
 */
export function compose(
  role: RoleRequirements,
  answers: AnswersMap,
): ClassificationResult {
  const dimensionScores: Record<string, DimensionScoreResult> = {};
  const confidences: number[] = [];
  let weightedSum = 0;

  for (const dimension of role.dimensions) {
    const answer = answers[dimension.id];
    if (!answer || answer.type !== "score") {
      throw new Error(`missing score answer for dimension "${dimension.id}"`);
    }
    const maxIndex = dimension.levels.length - 1;
    const normalizedScore = maxIndex === 0 ? answer.score : answer.score / maxIndex;

    dimensionScores[dimension.id] = {
      rawScore: answer.score,
      normalizedScore,
      confidence: answer.confidence,
      weight: dimension.weight,
    };
    weightedSum += dimension.weight * normalizedScore;
    confidences.push(answer.confidence);
  }

  const mustHaveFailures: string[] = [];
  const mustHaveUncertain: string[] = [];
  for (const mustHave of role.mustHaves) {
    const answer = answers[mustHave.id];
    if (!answer || answer.type !== "noul") {
      throw new Error(`missing noul answer for must-have "${mustHave.id}"`);
    }
    const confidence = noulConfidence(answer.noul);
    confidences.push(confidence);

    if (confidence < role.thresholds.confidenceFloor) {
      mustHaveUncertain.push(mustHave.id);
    } else if (answer.noul < 0.5) {
      mustHaveFailures.push(mustHave.id);
    }
  }

  const injectionAnswer = answers[INJECTION_RISK_QUESTION_ID];
  if (!injectionAnswer || injectionAnswer.type !== "noul") {
    throw new Error(`missing noul answer for "${INJECTION_RISK_QUESTION_ID}"`);
  }
  const injectionRiskDetected = injectionAnswer.noul >= INJECTION_RISK_THRESHOLD;
  confidences.push(noulConfidence(injectionAnswer.noul));

  const compositeScore = weightedSum;
  const compositeConfidence = confidences.length ? Math.min(...confidences) : null;

  // Must-have failure is a hard gate — a confidently-unmet requirement rejects
  // regardless of how well the candidate scores elsewhere. This is a plain code
  // `if`, not a model call, so it stays auditable and adjustable.
  let recommendation: Recommendation;
  if (mustHaveFailures.length > 0) {
    recommendation = "reject";
  } else if (compositeScore >= role.thresholds.contact) {
    recommendation = "contact";
  } else if (compositeScore <= role.thresholds.reject) {
    recommendation = "reject";
  } else {
    recommendation = "maybe";
  }

  const reviewReasons: string[] = [];
  if (injectionRiskDetected) {
    reviewReasons.push(
      "possible prompt injection detected in the candidate's profile text",
    );
  }
  if (mustHaveUncertain.length > 0) {
    reviewReasons.push(
      `uncertain whether must-have(s) are met: ${mustHaveUncertain.join(", ")}`,
    );
  }
  if (
    compositeConfidence !== null &&
    compositeConfidence < role.thresholds.confidenceFloor
  ) {
    reviewReasons.push(
      `overall confidence ${compositeConfidence.toFixed(2)} is below the floor of ${role.thresholds.confidenceFloor}`,
    );
  }

  return {
    recommendation,
    compositeScore,
    compositeConfidence,
    dimensionScores,
    needsReview: reviewReasons.length > 0,
    reviewReason: reviewReasons.length > 0 ? reviewReasons.join("; ") : null,
    rawAnswers: answers,
  };
}
