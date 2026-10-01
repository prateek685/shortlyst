import { injectionRiskQuestion, INJECTION_RISK_QUESTION_ID } from "../classify/buildQuestions";
import { choice, noul, type Questions } from "../jev/client";

// Jev call 1 for an email thread: is it an application at all, and for which
// open role? Question building and answer interpretation are pure (the Jev
// call itself lives in triage.service.ts).

export const IS_APPLICATION_QUESTION_ID = "is_job_application";
export const APPLIED_ROLE_QUESTION_ID = "applied_role";
export const NONE_OF_THESE = "none_of_these";

/** Below this, an answer counts as "unsure" and the thread goes to Needs
 * review instead of being decided automatically. */
export const TRIAGE_CONFIDENCE_FLOOR = 0.5;

export interface OpenRole {
  roleId: string;
  description?: string;
}

export function buildTriageQuestions(roles: OpenRole[]): Questions {
  const roleCriteria: Record<string, string> = {};
  for (const role of roles) {
    roleCriteria[role.roleId] = role.description?.trim() || role.roleId.replace(/[-_]+/g, " ");
  }
  roleCriteria[NONE_OF_THESE] = "a role that isn't in this list, or it's impossible to tell which role";

  return {
    [IS_APPLICATION_QUESTION_ID]: noul(
      "Is this email thread a job application, or a candidate expressing interest in a job, " +
        "sent by the candidate themselves (for example with a CV or a description of their experience)?",
      {
        true: "a candidate applying for, or asking about, a job for themselves",
        false:
          "anything else: vendors, sales or partnership offers, newsletters, notifications, invoices, " +
          "internal mail, recruiters pitching other people",
      },
    ),
    [APPLIED_ROLE_QUESTION_ID]: choice(
      "Which of these open roles is the candidate applying for? Judge by the role they name and by " +
        "their experience and skills.",
      roleCriteria,
    ),
    [INJECTION_RISK_QUESTION_ID]: injectionRiskQuestion(),
  };
}

export interface TriageAnswers {
  /** probability the thread is a job application */
  isApplication: number;
  /** chosen role id, or null for "none of these" */
  roleId: string | null;
  roleConfidence: number | null;
  /** probability the text tries to manipulate the evaluator */
  injectionRisk: number;
}

interface NoulAnswer {
  noul: number;
}
interface ChoiceAnswer {
  choice: string;
  confidence: number;
}

export function readTriageAnswers(answers: Record<string, unknown>): TriageAnswers {
  const application = answers[IS_APPLICATION_QUESTION_ID] as NoulAnswer;
  const role = answers[APPLIED_ROLE_QUESTION_ID] as ChoiceAnswer;
  const injection = answers[INJECTION_RISK_QUESTION_ID] as NoulAnswer;
  return {
    isApplication: application.noul,
    roleId: role.choice === NONE_OF_THESE ? null : role.choice,
    roleConfidence: role.confidence,
    injectionRisk: injection.noul,
  };
}

export type TriageDecision =
  | { kind: "not_candidate"; reason: string }
  | { kind: "needs_review"; reason: string }
  | { kind: "application"; roleId: string };

// Same "distance from a coin flip" confidence the classification's compose.ts
// uses for nouls.
const noulConfidence = (p: number) => Math.abs(p - 0.5) * 2;

export function decideTriage(answers: TriageAnswers, floor = TRIAGE_CONFIDENCE_FLOOR): TriageDecision {
  if (answers.injectionRisk >= 0.5) {
    return { kind: "needs_review", reason: "possible attempt to manipulate the automated evaluator" };
  }

  if (noulConfidence(answers.isApplication) < floor) {
    return { kind: "needs_review", reason: "unsure whether this is a job application" };
  }
  if (answers.isApplication < 0.5) {
    return { kind: "not_candidate", reason: "not a job application" };
  }

  if (!answers.roleId) {
    return { kind: "needs_review", reason: "application doesn't match any open role" };
  }
  if ((answers.roleConfidence ?? 0) < floor) {
    return {
      kind: "needs_review",
      reason: `unsure which role this is for (best guess: ${answers.roleId}, confidence ${(answers.roleConfidence ?? 0).toFixed(2)})`,
    };
  }
  return { kind: "application", roleId: answers.roleId };
}
