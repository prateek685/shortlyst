import type { CvTextResult } from "./cv-text";
import { processThread, type PipelineDeps } from "./pipeline";
import type { MailMessage, MailProvider, MailThread, Outcome } from "./provider";
import { stripQuotedReply } from "./thread-text";
import type { TriageAnswers } from "./triage";
import type { ClassificationResult } from "../types/candidate";

// The pipeline only ever sees this fake — proof it doesn't depend on Gmail.
class FakeProvider implements MailProvider {
  readonly type = "gmail" as const;
  readonly displayName = "Fake";
  applied: { threadId: string; outcomes: Outcome[] }[] = [];
  attachmentsFetched: string[] = [];

  constructor(private readonly thread: MailThread) {}

  isConfigured = () => true;
  authUrl = () => "";
  exchangeCode = async () => ({ credentials: {}, mailbox: "" });
  revoke = async () => undefined;
  initialCursor = async () => "0";
  listChangedThreads = async () => ({ messages: [], nextCursor: "0" });
  listThreadsSince = async () => [];
  ensureTags = async (_c: unknown, state: Record<string, unknown>) => state;
  getThread = async () => this.thread;
  getAttachment = async (_c: unknown, _m: string, attachmentId: string) => {
    this.attachmentsFetched.push(attachmentId);
    return Buffer.from(attachmentId);
  };
  applyOutcome = async (_c: unknown, _s: unknown, threadId: string, outcomes: Outcome[]) => {
    this.applied.push({ threadId, outcomes });
  };
  threadLink = (_mailbox: string, threadId: string) => `https://mail.example/${threadId}`;
}

const MAILBOX = "hr@tequity.tech";

function email(overrides: Partial<MailMessage> = {}): MailMessage {
  return {
    id: "m1",
    from: { email: "arti@gmail.com", name: "Arti Parihar" },
    to: [MAILBOX],
    subject: "Application – Full Stack Developer",
    receivedAt: new Date("2026-09-29T10:00:00Z"),
    headers: {},
    bodyText: "Hi, please find my CV attached.",
    attachments: [],
    ...overrides,
  };
}

const RESULT: ClassificationResult = {
  recommendation: "contact",
  compositeScore: 0.71,
  compositeConfidence: 0.8,
  dimensionScores: {},
  needsReview: false,
  reviewReason: null,
  rawAnswers: {},
};

function deps(overrides: Partial<PipelineDeps> & { triageAnswers?: Partial<TriageAnswers> } = {}) {
  const calls = { triage: [] as string[], classify: [] as { candidate: unknown; roleId: string }[] };
  const d: PipelineDeps = {
    listRoles: async () => [{ roleId: "fullstack-developer-tequity" }, { roleId: "qa-engineer-tequity" }],
    triage: async (text) => {
      calls.triage.push(text);
      return {
        isApplication: 0.97,
        roleId: "fullstack-developer-tequity",
        roleConfidence: 0.93,
        injectionRisk: 0.02,
        ...overrides.triageAnswers,
      };
    },
    classify: async (candidate, roleId) => {
      calls.classify.push({ candidate, roleId });
      return { result: RESULT, candidateId: "cand-1", resultId: "res-1" };
    },
    extractCv: async (buffer): Promise<CvTextResult> =>
      buffer.toString() === "scanned"
        ? { ok: false, reason: "no readable text (scanned image?)" }
        : { ok: true, text: `CV TEXT OF ${buffer.toString()}` },
    ...overrides,
  };
  return { d, calls };
}

const run = (thread: MailThread, d: PipelineDeps, provider = new FakeProvider(thread), tagNotCandidate = false) =>
  processThread({ provider, credentials: {}, state: {}, mailbox: MAILBOX, threadId: thread.id, tagNotCandidate }, d).then((r) => ({
    result: r,
    provider,
  }));

describe("processThread", () => {
  it("application with a CV → triage, classify the chosen role, tag the outcome", async () => {
    const thread = {
      id: "t1",
      messages: [email({ attachments: [{ id: "cv-pdf", filename: "Arti_CV.pdf", mimeType: "application/pdf", size: 10 }] })],
    };
    const { d, calls } = deps();
    const { result, provider } = await run(thread, d);

    expect(calls.triage).toHaveLength(1);
    expect(calls.triage[0]).toContain("CV TEXT OF cv-pdf");
    expect(calls.classify).toEqual([
      {
        roleId: "fullstack-developer-tequity",
        candidate: expect.objectContaining({
          source: "email",
          externalId: "arti@gmail.com",
          email: "arti@gmail.com",
          name: "Arti Parihar",
        }),
      },
    ]);
    expect(provider.applied).toEqual([{ threadId: "t1", outcomes: ["contact"] }]);
    expect(result).toMatchObject({
      outcome: "contact",
      roleId: "fullstack-developer-tequity",
      candidateId: "cand-1",
      resultId: "res-1",
      link: "https://mail.example/t1",
    });
    expect(result.messages[0]).toMatchObject({ status: "done", skipReason: null });
  });

  it("newsletter → Not a candidate without any Jev call, left untagged (older Shortlyst tags removed)", async () => {
    const thread = { id: "t2", messages: [email({ headers: { "list-unsubscribe": "<mailto:u@x>" } })] };
    const { d, calls } = deps();
    const { result, provider } = await run(thread, d);

    expect(calls.triage).toHaveLength(0);
    expect(calls.classify).toHaveLength(0);
    expect(provider.applied).toEqual([{ threadId: "t2", outcomes: [] }]);
    expect(result).toMatchObject({ outcome: "not_candidate", tags: [] });
    expect(result.messages[0]).toMatchObject({ status: "skipped", skipReason: "bulk mail (mailing list)" });
  });

  it("with tagNotCandidate on, a non-candidate gets the Not a candidate tag", async () => {
    const thread = { id: "t2b", messages: [email({ headers: { "list-unsubscribe": "<mailto:u@x>" } })] };
    const { d } = deps();
    const { provider } = await run(thread, d, new FakeProvider(thread), true);
    expect(provider.applied).toEqual([{ threadId: "t2b", outcomes: ["not_candidate"] }]);
  });

  it("vendor email → triage says not an application → no classification", async () => {
    const thread = { id: "t3", messages: [email({ subject: "Partnership proposal", from: { email: "sales@vendor.com" } })] };
    const { d, calls } = deps({ triageAnswers: { isApplication: 0.04 } });
    const { result, provider } = await run(thread, d);

    expect(calls.triage).toHaveLength(1);
    expect(calls.classify).toHaveLength(0);
    expect(result.outcome).toBe("not_candidate");
    expect(provider.applied[0]!.outcomes).toEqual([]);
  });

  it("unsure role → Needs review, no classification", async () => {
    const { d, calls } = deps({ triageAnswers: { roleConfidence: 0.3 } });
    const { result } = await run({ id: "t4", messages: [email()] }, d);
    expect(calls.classify).toHaveLength(0);
    expect(result.outcome).toBe("needs_review");
  });

  it("only CV is scanned → classified, but also tagged Needs review with the reason", async () => {
    const thread = {
      id: "t5",
      messages: [email({ attachments: [{ id: "scanned", filename: "scan.pdf", mimeType: "application/pdf", size: 10 }] })],
    };
    const { d } = deps();
    const { result, provider } = await run(thread, d);
    expect(provider.applied[0]!.outcomes).toEqual(["contact", "needs_review"]);
    expect(result.reason).toContain("couldn't read CV");
  });

  it("follow-up in the same thread: both messages and the late CV are read; HR's reply is ignored", async () => {
    const thread = {
      id: "t6",
      messages: [
        email({ id: "m1", bodyText: "I'd like to apply for the full stack role." }),
        email({ id: "m2", from: { email: MAILBOX }, bodyText: "Thanks, could you send your CV?" }),
        email({
          id: "m3",
          bodyText: "Sorry, CV attached.\nOn Mon, HR wrote:\n> Thanks, could you send your CV?",
          attachments: [{ id: "late-cv", filename: "cv.docx", mimeType: "application/octet-stream", size: 10 }],
        }),
      ],
    };
    const { d, calls } = deps();
    const { result } = await run(thread, d);

    expect(calls.triage[0]).toContain("I'd like to apply");
    expect(calls.triage[0]).toContain("Sorry, CV attached.");
    expect(calls.triage[0]).toContain("CV TEXT OF late-cv");
    expect(calls.triage[0]).not.toContain("could you send your CV");
    expect(result.messages.find((m) => m.messageId === "m2")).toMatchObject({
      status: "skipped",
      skipReason: "sent by the connected mailbox",
    });
  });

  it("no open roles → Needs review", async () => {
    const { d } = deps({ listRoles: async () => [] });
    const { result } = await run({ id: "t7", messages: [email()] }, d);
    expect(result).toMatchObject({ outcome: "needs_review", reason: "no open roles to match against" });
  });
});

describe("stripQuotedReply", () => {
  it("drops the quoted conversation below 'On … wrote:' and '>' lines", () => {
    expect(stripQuotedReply("New text\n> quoted\nmore new\nOn Tue, 29 Sep, HR wrote:\nold stuff")).toBe("New text\nmore new");
  });
});
