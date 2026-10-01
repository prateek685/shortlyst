import { CursorExpiredError, ProviderRequestError } from "../../provider";
import { forgetAccessToken, getAccessToken } from "./gmail.oauth";

// Thin fetch wrappers over the Gmail REST API v1 — only the calls the
// adapter needs. Response types cover just the fields we read.

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPart {
  partId?: string;
  mimeType: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate: string;
  payload: GmailPart;
}

export interface GmailThread {
  id: string;
  messages?: GmailMessage[];
}

export interface GmailLabel {
  id: string;
  name: string;
}

export class GmailNotFoundError extends ProviderRequestError {
  constructor(what: string) {
    super(`Gmail: ${what} not found`, 404, false);
  }
}

async function gmailFetch<T>(refreshToken: string, path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken(refreshToken);
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
    });
  } catch (err) {
    throw new ProviderRequestError(`Gmail unreachable: ${(err as Error).message}`, undefined, true);
  }

  if (response.ok) return (await response.json()) as T;

  const text = await response.text().catch(() => "");
  if (response.status === 401) {
    // Stale access token: drop it so the retry refreshes. A dead refresh
    // token then surfaces as AuthExpiredError from getAccessToken().
    forgetAccessToken(refreshToken);
    throw new ProviderRequestError("Gmail rejected the access token", 401, true);
  }
  if (response.status === 404) throw new GmailNotFoundError(path.split("?")[0]!);
  const retryable = response.status === 429 || response.status >= 500;
  throw new ProviderRequestError(`Gmail ${path.split("?")[0]}: ${response.status} ${text.slice(0, 300)}`, response.status, retryable);
}

export function getProfile(refreshToken: string) {
  return gmailFetch<{ emailAddress: string; historyId: string }>(refreshToken, "/profile");
}

interface HistoryPage {
  history?: { messagesAdded?: { message: { id: string; threadId: string; labelIds?: string[] } }[] }[];
  historyId: string;
  nextPageToken?: string;
}

/** All inbox messages added since `startHistoryId`, across pages. */
export async function listHistory(
  refreshToken: string,
  startHistoryId: string,
): Promise<{ messages: { id: string; threadId: string }[]; historyId: string }> {
  const messages: { id: string; threadId: string }[] = [];
  let pageToken: string | undefined;
  let historyId = startHistoryId;
  do {
    const params = new URLSearchParams({
      startHistoryId,
      historyTypes: "messageAdded",
      labelId: "INBOX",
      maxResults: "500",
      ...(pageToken ? { pageToken } : {}),
    });
    let page: HistoryPage;
    try {
      page = await gmailFetch<HistoryPage>(refreshToken, `/history?${params.toString()}`);
    } catch (err) {
      // Gmail keeps change history for a limited time (about a week); an
      // older startHistoryId answers 404.
      if (err instanceof GmailNotFoundError) throw new CursorExpiredError("Gmail history expired");
      throw err;
    }
    for (const entry of page.history ?? []) {
      for (const added of entry.messagesAdded ?? []) {
        messages.push({ id: added.message.id, threadId: added.message.threadId });
      }
    }
    historyId = page.historyId;
    pageToken = page.nextPageToken;
  } while (pageToken);
  return { messages, historyId };
}

/** Messages matching a Gmail search query, across pages. */
export async function searchMessages(refreshToken: string, q: string): Promise<{ id: string; threadId: string }[]> {
  const messages: { id: string; threadId: string }[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ q, maxResults: "500", ...(pageToken ? { pageToken } : {}) });
    const page = await gmailFetch<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>(
      refreshToken,
      `/messages?${params.toString()}`,
    );
    messages.push(...(page.messages ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return messages;
}

export function getThread(refreshToken: string, threadId: string) {
  return gmailFetch<GmailThread>(refreshToken, `/threads/${encodeURIComponent(threadId)}?format=full`);
}

export async function getAttachment(refreshToken: string, messageId: string, attachmentId: string): Promise<Buffer> {
  const json = await gmailFetch<{ data: string; size: number }>(
    refreshToken,
    `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
  );
  return Buffer.from(json.data, "base64url");
}

export async function listLabels(refreshToken: string): Promise<GmailLabel[]> {
  const json = await gmailFetch<{ labels?: GmailLabel[] }>(refreshToken, "/labels");
  return json.labels ?? [];
}

export function createLabel(refreshToken: string, name: string) {
  return gmailFetch<GmailLabel>(refreshToken, "/labels", {
    method: "POST",
    body: JSON.stringify({ name, labelListVisibility: "labelShow", messageListVisibility: "show" }),
  });
}

export function modifyThread(refreshToken: string, threadId: string, addLabelIds: string[], removeLabelIds: string[]) {
  return gmailFetch<unknown>(refreshToken, `/threads/${encodeURIComponent(threadId)}/modify`, {
    method: "POST",
    body: JSON.stringify({ addLabelIds, removeLabelIds }),
  });
}
