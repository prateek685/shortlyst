import {
  INJECTION_RISK_QUESTION_ID,
  buildQuestions,
  selectState,
} from "./buildQuestions";
import type { RoleRequirements } from "../requirements/types";
import type { CandidateInput, LinkedInProfileData } from "../types/candidate";

const role: RoleRequirements = {
  roleId: "test-role",
  dimensions: [
    {
      id: "skill_a",
      instructions: "How strong is skill A?",
      weight: 0.6,
      levels: ["none", "some", "strong"],
    },
    {
      id: "skill_b",
      instructions: "How strong is skill B?",
      weight: 0.4,
      levels: ["none", "some", "strong"],
    },
  ],
  mustHaves: [{ id: "min_years", instructions: "At least 2 years experience?" }],
  thresholds: { contact: 0.65, reject: 0.35, confidenceFloor: 0.5 },
};

describe("buildQuestions", () => {
  it("builds one score question per dimension", () => {
    const questions = buildQuestions(role);
    expect(questions.skill_a.type).toBe("score");
    expect(questions.skill_b.type).toBe("score");
  });

  it("builds one noul question per must-have", () => {
    const questions = buildQuestions(role);
    expect(questions.min_years.type).toBe("noul");
  });

  it("always includes the fixed injection-risk noul question", () => {
    const questions = buildQuestions(role);
    expect(questions[INJECTION_RISK_QUESTION_ID]).toBeDefined();
    expect(questions[INJECTION_RISK_QUESTION_ID].type).toBe("noul");
  });

  it("produces exactly dimensions + mustHaves + 1 questions", () => {
    const questions = buildQuestions(role);
    expect(Object.keys(questions)).toHaveLength(
      role.dimensions.length + role.mustHaves.length + 1,
    );
  });
});

describe("selectState", () => {
  const flatCandidate: CandidateInput = {
    source: "manual",
    profileText: "Some plain resume text.",
  };

  const structuredProfile: LinkedInProfileData = {
    profileUrl: "https://linkedin.com/in/someone",
    headline: "Engineer",
    experience: [],
  };

  const structuredCandidate: CandidateInput = {
    source: "linkedin",
    profileText: "Engineer\n",
    structuredProfile,
  };

  it("returns profileText when structuredProfile is absent", () => {
    expect(selectState(flatCandidate)).toBe(flatCandidate.profileText);
  });

  it("returns the structured object when structuredProfile is present", () => {
    expect(selectState(structuredCandidate)).toBe(structuredProfile);
  });
});
