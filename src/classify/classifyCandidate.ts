import { askJev } from "../jev/client";
import { getLangfuse } from "../observability/langfuse";
import type { RoleRequirements } from "../requirements/types";
import type { CandidateInput, ClassificationResult } from "../types/candidate";
import { buildQuestions, selectState } from "./buildQuestions";
import { compose, type AnswersMap } from "./compose";

/**
 * The single public entry point for classification. Plain, framework-agnostic
 * function with no HTTP/NestJS knowledge and no knowledge of where
 * `candidate.profileText` came from — equally usable from the API layer, a
 * future email-ingestion job, or a batch script.
 *
 * Owns the Langfuse trace lifecycle: creates the parent trace, passes it to
 * jev/client.ts for the child generation, updates it with the final result.
 */
export async function classifyCandidate(
  candidate: CandidateInput,
  role: RoleRequirements,
): Promise<ClassificationResult> {
  const trace = getLangfuse().trace({
    name: "classify-candidate",
    input: { roleId: role.roleId, candidate },
  });

  const questions = buildQuestions(role);
  const state = selectState(candidate);
  const result = await askJev(state, questions, trace);
  const classification = compose(role, result.answers as AnswersMap);

  trace.update({ output: classification });

  return classification;
}
