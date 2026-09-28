import { compose, type AnswersMap } from "./compose";
import { INJECTION_RISK_QUESTION_ID } from "./buildQuestions";
import type { RoleRequirements } from "../requirements/types";

function scoreAnswer(score: number, confidence: number) {
  return {
    type: "score" as const,
    score,
    confidence,
    legend: {},
    probabilities: {},
  };
}

function noulAnswer(noul: number) {
  return { type: "noul" as const, noul };
}

const role: RoleRequirements = {
  roleId: "test-role",
  dimensions: [
    { id: "a", instructions: "...", weight: 0.7, levels: ["low", "mid", "high"] },
    { id: "b", instructions: "...", weight: 0.3, levels: ["low", "mid", "high"] },
  ],
  mustHaves: [{ id: "min_years", instructions: "..." }],
  thresholds: { contact: 0.65, reject: 0.35, confidenceFloor: 0.5 },
};

function baseAnswers(overrides: Partial<AnswersMap> = {}): AnswersMap {
  return {
    a: scoreAnswer(2, 0.9), // top level (index 2 of 3 -> normalized 1.0)
    b: scoreAnswer(2, 0.9),
    min_years: noulAnswer(0.95), // confidently met
    [INJECTION_RISK_QUESTION_ID]: noulAnswer(0.05), // confidently no risk
    ...overrides,
  };
}

describe("compose", () => {
  it("computes a weighted composite score from normalized dimension scores", () => {
    const result = compose(role, baseAnswers());
    expect(result.compositeScore).toBeCloseTo(1.0, 5);
  });

  it("buckets a high composite score as contact", () => {
    const result = compose(role, baseAnswers());
    expect(result.recommendation).toBe("contact");
  });

  it("buckets a low composite score as reject", () => {
    const answers = baseAnswers({
      a: scoreAnswer(0, 0.9),
      b: scoreAnswer(0, 0.9),
    });
    const result = compose(role, answers);
    expect(result.compositeScore).toBeCloseTo(0, 5);
    expect(result.recommendation).toBe("reject");
  });

  it("buckets a middling composite score as maybe", () => {
    const answers = baseAnswers({
      a: scoreAnswer(1, 0.9), // normalized 0.5
      b: scoreAnswer(1, 0.9),
    });
    const result = compose(role, answers);
    expect(result.recommendation).toBe("maybe");
  });

  it("forces reject when a must-have confidently fails, regardless of score", () => {
    const answers = baseAnswers({ min_years: noulAnswer(0.02) }); // confidently NOT met
    const result = compose(role, answers);
    expect(result.recommendation).toBe("reject");
  });

  it("flags needsReview when a must-have answer is uncertain, without forcing reject", () => {
    const answers = baseAnswers({ min_years: noulAnswer(0.51) }); // ~coin flip
    const result = compose(role, answers);
    expect(result.needsReview).toBe(true);
    expect(result.reviewReason).toMatch(/uncertain/i);
  });

  it("flags needsReview on suspected prompt injection", () => {
    const answers = baseAnswers({
      [INJECTION_RISK_QUESTION_ID]: noulAnswer(0.9),
    });
    const result = compose(role, answers);
    expect(result.needsReview).toBe(true);
    expect(result.reviewReason).toMatch(/injection/i);
  });

  it("flags needsReview when overall confidence is below the role's floor", () => {
    const answers = baseAnswers({
      a: scoreAnswer(2, 0.2), // low confidence
    });
    const result = compose(role, answers);
    expect(result.needsReview).toBe(true);
    expect(result.reviewReason).toMatch(/confidence/i);
  });

  it("does not flag needsReview when every signal is confident and no injection risk", () => {
    const result = compose(role, baseAnswers());
    expect(result.needsReview).toBe(false);
    expect(result.reviewReason).toBeNull();
  });

  it("changes the composite score when a dimension's weight changes, with no new answers", () => {
    const answers = baseAnswers({
      a: scoreAnswer(2, 0.9), // normalized 1.0
      b: scoreAnswer(0, 0.9), // normalized 0.0
    });
    const original = compose(role, answers);

    const reweighted: RoleRequirements = {
      ...role,
      dimensions: [
        { ...role.dimensions[0], weight: 0.2 },
        { ...role.dimensions[1], weight: 0.8 },
      ],
    };
    const reweightedResult = compose(reweighted, answers);

    expect(reweightedResult.compositeScore).not.toBeCloseTo(
      original.compositeScore,
      5,
    );
  });
});
