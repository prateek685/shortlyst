// The only contract the mail pipeline depends on. Gmail is the first (and,
// for now, only) adapter; Outlook/IMAP would be further adapters behind this
// same interface — the queue, pipeline, database and options page never
// learn which provider a mailbox uses beyond its `provider` column.
//
// Deliberately framework-free (no NestJS imports) so the pipeline can be
// unit-tested against a fake provider.

export type ProviderType = "gmail";

/** What a thread ends up tagged as in the mailbox. */
export type Outcome = "contact" | "maybe" | "reject" | "needs_review" | "not_candidate";

/** Provider-specific secrets (e.g. Gmail's refresh token). Encrypted at rest
 * (see credentials-crypto.ts) — the pipeline treats it as opaque. */
export type Credentials = Record<string, unknown>;

/** Provider-specific, non-secret state persisted per connection (e.g. the
 * ids of the outcome labels Gmail assigned). Opaque to the pipeline. */
export type ProviderState = Record<string, unknown>;

export interface MailAddress {
  email: string;
  name?: string;
}

export interface MailAttachmentRef {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

/** A message in the normalized shape every provider converts to. */
export interface MailMessage {
  id: string;
  from: MailAddress;
  to: string[];
  subject: string;
  receivedAt: Date;
  /** header names lower-cased */
  headers: Record<string, string>;
  bodyText?: string;
  bodyHtml?: string;
  attachments: MailAttachmentRef[];
}

export interface MailThread {
  id: string;
  messages: MailMessage[];
}

/** One message the provider reports as new, with the thread it belongs to. */
export interface MessageRef {
  messageId: string;
  threadId: string;
}

/** The sync cursor is too old for the provider to answer from (e.g. Gmail
 * keeps its change history for about a week) — fall back to a date search. */
export class CursorExpiredError extends Error {}

/** The stored credentials no longer work (password changed, access revoked,
 * app removed) — the mailbox must be reconnected. */
export class AuthExpiredError extends Error {}

/** A provider API call failed. `retryable` = worth trying again later
 * (network, rate limit, 5xx); otherwise the request itself is the problem. */
export class ProviderRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface MailProvider {
  readonly type: ProviderType;
  readonly displayName: string;
  /** True when this provider's settings (client id/secret…) are present. */
  isConfigured(): boolean;

  // --- connect -------------------------------------------------------------
  authUrl(state: string): string;
  exchangeCode(code: string): Promise<{ credentials: Credentials; mailbox: string }>;
  revoke(credentials: Credentials): Promise<void>;

  // --- sync ----------------------------------------------------------------
  /** The provider's "now" position — changes after this are "new". */
  initialCursor(credentials: Credentials): Promise<string>;
  /** Inbox messages added since `cursor`. Throws CursorExpiredError. */
  listChangedThreads(
    credentials: Credentials,
    cursor: string,
  ): Promise<{ messages: MessageRef[]; nextCursor: string }>;
  /** Fallback: inbox messages received since `since`. */
  listThreadsSince(credentials: Credentials, since: Date): Promise<MessageRef[]>;

  // --- read ----------------------------------------------------------------
  getThread(credentials: Credentials, threadId: string): Promise<MailThread>;
  getAttachment(credentials: Credentials, messageId: string, attachmentId: string): Promise<Buffer>;

  // --- write back ----------------------------------------------------------
  /**
   * Makes sure a tag exists for each of `outcomes` (recreating any the user
   * deleted); returns the state to persist.
   */
  ensureTags(credentials: Credentials, state: ProviderState, outcomes: Outcome[]): Promise<ProviderState>;
  /** Adds the given outcome tags to the thread, removes any other Shortlyst tag. */
  applyOutcome(
    credentials: Credentials,
    state: ProviderState,
    threadId: string,
    outcomes: Outcome[],
  ): Promise<void>;
  /** A link HR can open to see the thread in the provider's web app. */
  threadLink(mailbox: string, threadId: string): string;
}
