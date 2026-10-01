import type {
  Credentials,
  MailProvider,
  MailThread,
  MessageRef,
  Outcome,
  ProviderState,
} from "../../provider";
import * as api from "./gmail.api";
import { toMailThread } from "./gmail.mime";
import { buildAuthUrl, exchangeCodeForTokens, gmailOAuthConfig, revokeToken } from "./gmail.oauth";

// Gmail adapter: outcomes are nested labels under "Shortlyst/", the cursor
// is Gmail's historyId, threads are Gmail threads.

const PARENT_LABEL = "Shortlyst";
export const OUTCOME_LABELS: Record<Outcome, string> = {
  contact: "Shortlyst/Contact",
  maybe: "Shortlyst/Maybe",
  reject: "Shortlyst/Reject",
  needs_review: "Shortlyst/Needs review",
  not_candidate: "Shortlyst/Not a candidate",
};

interface GmailCredentials {
  refreshToken: string;
}

interface GmailState {
  /** outcome → Gmail label id */
  labelIds?: Partial<Record<Outcome, string>>;
}

function refreshTokenOf(credentials: Credentials): string {
  const { refreshToken } = credentials as unknown as GmailCredentials;
  if (!refreshToken) throw new Error("Gmail credentials are missing a refresh token");
  return refreshToken;
}

export class GmailProvider implements MailProvider {
  readonly type = "gmail" as const;
  readonly displayName = "Gmail (Google Workspace)";

  isConfigured(): boolean {
    return gmailOAuthConfig() !== null;
  }

  authUrl(state: string): string {
    return buildAuthUrl(state);
  }

  async exchangeCode(code: string): Promise<{ credentials: Credentials; mailbox: string }> {
    const { refreshToken } = await exchangeCodeForTokens(code);
    const profile = await api.getProfile(refreshToken);
    return { credentials: { refreshToken }, mailbox: profile.emailAddress.toLowerCase() };
  }

  revoke(credentials: Credentials): Promise<void> {
    return revokeToken(refreshTokenOf(credentials));
  }

  async initialCursor(credentials: Credentials): Promise<string> {
    const profile = await api.getProfile(refreshTokenOf(credentials));
    return profile.historyId;
  }

  async listChangedThreads(
    credentials: Credentials,
    cursor: string,
  ): Promise<{ messages: MessageRef[]; nextCursor: string }> {
    const { messages, historyId } = await api.listHistory(refreshTokenOf(credentials), cursor);
    return { messages: messages.map((m) => ({ messageId: m.id, threadId: m.threadId })), nextCursor: historyId };
  }

  async listThreadsSince(credentials: Credentials, since: Date): Promise<MessageRef[]> {
    const afterSeconds = Math.floor(since.getTime() / 1000);
    const messages = await api.searchMessages(refreshTokenOf(credentials), `in:inbox after:${afterSeconds}`);
    return messages.map((m) => ({ messageId: m.id, threadId: m.threadId }));
  }

  async getThread(credentials: Credentials, threadId: string): Promise<MailThread> {
    return toMailThread(await api.getThread(refreshTokenOf(credentials), threadId));
  }

  getAttachment(credentials: Credentials, messageId: string, attachmentId: string): Promise<Buffer> {
    return api.getAttachment(refreshTokenOf(credentials), messageId, attachmentId);
  }

  async ensureTags(credentials: Credentials, state: ProviderState, outcomes: Outcome[]): Promise<ProviderState> {
    // Always checked against Gmail (one call per sync): HR may have deleted a
    // label, and a cached id of a deleted label would make every tag fail.
    const refreshToken = refreshTokenOf(credentials);
    const existing = await api.listLabels(refreshToken);
    const byName = new Map(existing.map((label) => [label.name, label.id]));

    // The parent makes Gmail show the outcome labels nested under "Shortlyst".
    if (!byName.has(PARENT_LABEL)) {
      const parent = await api.createLabel(refreshToken, PARENT_LABEL);
      byName.set(parent.name, parent.id);
    }

    const labelIds: Partial<Record<Outcome, string>> = {};
    for (const outcome of outcomes) {
      const name = OUTCOME_LABELS[outcome];
      let id = byName.get(name);
      if (!id) {
        id = (await api.createLabel(refreshToken, name)).id;
      }
      labelIds[outcome] = id;
    }
    const current = (state as GmailState).labelIds ?? {};
    const unchanged =
      Object.keys(current).length === outcomes.length && outcomes.every((o) => current[o] === labelIds[o]);
    return unchanged ? state : { ...state, labelIds };
  }

  async applyOutcome(
    credentials: Credentials,
    state: ProviderState,
    threadId: string,
    outcomes: Outcome[],
  ): Promise<void> {
    const labelIds = (state as GmailState).labelIds ?? {};
    const add = outcomes.map((o) => labelIds[o]).filter((id): id is string => Boolean(id));
    if (add.length !== outcomes.length) throw new Error("Gmail outcome labels are not set up yet");
    const remove = Object.values(labelIds).filter((id): id is string => Boolean(id) && !add.includes(id));
    await api.modifyThread(refreshTokenOf(credentials), threadId, add, remove);
  }

  threadLink(mailbox: string, threadId: string): string {
    return `https://mail.google.com/mail/?authuser=${encodeURIComponent(mailbox)}#all/${threadId}`;
  }
}
