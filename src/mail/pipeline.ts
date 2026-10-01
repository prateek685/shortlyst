import { cvKind, type CvKind, type CvTextResult } from "./cv-text";
import { skipReason } from "./prefilter";
import type { Credentials, MailMessage, MailProvider, Outcome, ProviderState } from "./provider";
import { buildThreadText, type ReadCv } from "./thread-text";
import { decideTriage, type OpenRole, type TriageAnswers } from "./triage";
import type { CandidateInput, ClassificationResult } from "../types/candidate";

// Steps 7–13 of the plan for one thread: fetch → pre-filter → read CVs →
// build text → triage → classify → tag. Framework-free and storage-free —
// everything it touches comes in through `input`/`deps`, so it runs against
// a fake MailProvider in tests (mail-process.service.ts persists the result).

export interface PipelineDeps {
  listRoles(): Promise<OpenRole[]>;
  /** Jev call 1 (cached) */
  triage(text: string, roles: OpenRole[]): Promise<TriageAnswers>;
  /** Jev call 2 — the shared classification path */
  classify(
    candidate: CandidateInput,
    roleId: string,
  ): Promise<{ result: ClassificationResult; candidateId: string; resultId: string }>;
  extractCv(buffer: Buffer, kind: CvKind): Promise<CvTextResult>;
}

export interface PipelineInput {
  provider: MailProvider;
  credentials: Credentials;
  state: ProviderState;
  mailbox: string;
  threadId: string;
  /** false: non-candidate threads get no tag (any older Shortlyst tag is removed) */
  tagNotCandidate: boolean;
}

export interface MessageOutcome {
  messageId: string;
  fromEmail: string;
  fromName: string | null;
  subject: string;
  receivedAt: Date;
  status: "done" | "skipped";
  skipReason: string | null;
}

export interface PipelineResult {
  outcome: Outcome;
  /** tags applied to the thread (the outcome, plus Needs review when flagged) */
  tags: Outcome[];
  reason: string | null;
  roleId: string | null;
  candidateId: string | null;
  resultId: string | null;
  link: string;
  messages: MessageOutcome[];
}

export async function processThread(input: PipelineInput, deps: PipelineDeps): Promise<PipelineResult> {
  const { provider, credentials, state, mailbox, threadId, tagNotCandidate } = input;
  const thread = await provider.getThread(credentials, threadId);
  const link = provider.threadLink(mailbox, threadId);

  // --- pre-filter (no Jev cost) ----------------------------------------------
  const reasons = new Map<string, string | null>();
  for (const message of thread.messages) reasons.set(message.id, skipReason(message, mailbox));
  const inbound = thread.messages.filter((m) => reasons.get(m.id) === null);

  const messageOutcomes = (processed: boolean): MessageOutcome[] =>
    thread.messages.map((m) => ({
      messageId: m.id,
      fromEmail: m.from.email,
      fromName: m.from.name ?? null,
      subject: m.subject,
      receivedAt: m.receivedAt,
      status: processed && reasons.get(m.id) === null ? "done" : "skipped",
      skipReason: reasons.get(m.id) ?? null,
    }));

  const finish = async (
    outcome: Outcome,
    reason: string | null,
    extra: Partial<Pick<PipelineResult, "roleId" | "candidateId" | "resultId">> & { alsoNeedsReview?: boolean } = {},
  ): Promise<PipelineResult> => {
    const tags: Outcome[] =
      outcome === "not_candidate" && !tagNotCandidate
        ? []
        : extra.alsoNeedsReview && outcome !== "needs_review"
          ? [outcome, "needs_review"]
          : [outcome];
    await provider.applyOutcome(credentials, state, threadId, tags);
    return {
      outcome,
      tags,
      reason,
      roleId: extra.roleId ?? null,
      candidateId: extra.candidateId ?? null,
      resultId: extra.resultId ?? null,
      link,
      messages: messageOutcomes(outcome !== "not_candidate" || inbound.length > 0),
    };
  };

  if (inbound.length === 0) {
    const firstReason = [...reasons.values()].find(Boolean) ?? "no messages from a candidate";
    return finish("not_candidate", firstReason);
  }

  // --- read CVs --------------------------------------------------------------
  const cvs: ReadCv[] = [];
  const unreadable: string[] = [];
  for (const message of inbound) {
    for (const attachment of message.attachments) {
      const kind = cvKind(attachment);
      if (!kind) continue;
      const buffer = await provider.getAttachment(credentials, message.id, attachment.id);
      const read = await deps.extractCv(buffer, kind);
      if (read.ok) cvs.push({ filename: attachment.filename, text: read.text });
      else unreadable.push(`${attachment.filename}: ${read.reason}`);
    }
  }
  // Only a problem when no CV could be read at all — one unreadable file next
  // to a readable one still leaves Jev enough to judge.
  const cvProblem = cvs.length === 0 && unreadable.length > 0 ? `couldn't read CV (${unreadable.join("; ")})` : null;

  const text = buildThreadText(inbound, cvs);

  // --- triage (Jev call 1) ---------------------------------------------------
  const roles = await deps.listRoles();
  if (roles.length === 0) return finish("needs_review", "no open roles to match against");

  const decision = decideTriage(await deps.triage(text, roles));
  if (decision.kind === "not_candidate") return finish("not_candidate", decision.reason);
  if (decision.kind === "needs_review") return finish("needs_review", joinReasons(decision.reason, cvProblem));

  // --- classify (Jev call 2) -------------------------------------------------
  const sender = senderOf(inbound);
  const { result, candidateId, resultId } = await deps.classify(
    {
      source: "email",
      externalId: sender.email,
      profileText: text,
      name: sender.name ?? sender.email,
      email: sender.email,
    },
    decision.roleId,
  );

  return finish(result.recommendation, joinReasons(result.reviewReason, cvProblem), {
    roleId: decision.roleId,
    candidateId,
    resultId,
    alsoNeedsReview: result.needsReview || cvProblem !== null,
  });
}

function senderOf(inbound: MailMessage[]): { email: string; name?: string } {
  return inbound[0]!.from;
}

function joinReasons(...reasons: (string | null)[]): string | null {
  const present = reasons.filter((r): r is string => Boolean(r));
  return present.length ? present.join("; ") : null;
}
