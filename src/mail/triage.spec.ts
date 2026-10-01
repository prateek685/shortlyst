import { INJECTION_RISK_QUESTION_ID } from "../classify/buildQuestions";
import {
  APPLIED_ROLE_QUESTION_ID,
  buildTriageQuestions,
  decideTriage,
  IS_APPLICATION_QUESTION_ID,
  NONE_OF_THESE,
  readTriageAnswers,
  type TriageAnswers,
} from "./triage";

const ROLES = [
  { roleId: "fullstack-developer-tequity", description: "Full-stack developer, React + Node, 5+ years" },
  { roleId: "qa-engineer-tequity" },
];

const answers = (overrides: Partial<TriageAnswers> = {}): TriageAnswers => ({
  isApplication: 0.97,
  roleId: "fullstack-developer-tequity",
  roleConfidence: 0.93,
  injectionRisk: 0.02,
  ...overrides,
});

describe("buildTriageQuestions", () => {
  it("asks application / role choice / injection, offering every role plus none", () => {
    const questions = buildTriageQuestions(ROLES) as Record<string, { type: string; criteria?: Record<string, string> }>;
    expect(Object.keys(questions).sort()).toEqual(
      [APPLIED_ROLE_QUESTION_ID, INJECTION_RISK_QUESTION_ID, IS_APPLICATION_QUESTION_ID].sort(),
    );
    expect(questions[IS_APPLICATION_QUESTION_ID]!.type).toBe("noul");
    expect(questions[APPLIED_ROLE_QUESTION_ID]!.type).toBe("choice");
    expect(questions[APPLIED_ROLE_QUESTION_ID]!.criteria).toEqual({
      "fullstack-developer-tequity": "Full-stack developer, React + Node, 5+ years",
      // a role without a description falls back to its readable id
      "qa-engineer-tequity": "qa engineer tequity",
      [NONE_OF_THESE]: expect.any(String),
    });
  });
});

describe("readTriageAnswers", () => {
  it("maps Jev's answers, with none_of_these → null role", () => {
    expect(
      readTriageAnswers({
        [IS_APPLICATION_QUESTION_ID]: { type: "noul", noul: 0.9 },
        [APPLIED_ROLE_QUESTION_ID]: { type: "choice", choice: NONE_OF_THESE, confidence: 0.7, probabilities: {} },
        [INJECTION_RISK_QUESTION_ID]: { type: "noul", noul: 0.01 },
      }),
    ).toEqual({ isApplication: 0.9, roleId: null, roleConfidence: 0.7, injectionRisk: 0.01 });
  });
});

describe("decideTriage", () => {
  it("a confident application for a confident role → application", () => {
    expect(decideTriage(answers())).toEqual({ kind: "application", roleId: "fullstack-developer-tequity" });
  });

  it("confidently not an application → not a candidate", () => {
    expect(decideTriage(answers({ isApplication: 0.04 }))).toEqual({ kind: "not_candidate", reason: "not a job application" });
  });

  it("unsure whether it's an application → needs review", () => {
    expect(decideTriage(answers({ isApplication: 0.55 })).kind).toBe("needs_review");
  });

  it("no matching role → needs review", () => {
    expect(decideTriage(answers({ roleId: null }))).toEqual({
      kind: "needs_review",
      reason: "application doesn't match any open role",
    });
  });

  it("low role confidence → needs review, naming the best guess", () => {
    const decision = decideTriage(answers({ roleConfidence: 0.4 }));
    expect(decision.kind).toBe("needs_review");
    if (decision.kind === "needs_review") expect(decision.reason).toContain("fullstack-developer-tequity");
  });

  it("possible prompt injection → needs review, before anything else", () => {
    expect(decideTriage(answers({ injectionRisk: 0.8 })).kind).toBe("needs_review");
  });
});
