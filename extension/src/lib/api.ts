import type {
  CandidateInput,
  ClassificationResult,
  MailConnectionStatus,
  MailProviderInfo,
  MailRecentThread,
  RoleImportSummary,
  RoleRequirements,
  RoleSummary,
  ShortlistedCandidate,
} from "./types.js";
import { DEFAULT_BACKEND_URL } from "./config.js";

export const API_KEY_STORAGE_KEY = "shortlystApiKey";
export const SERVER_URL_STORAGE_KEY = "shortlystServerUrl";

/** The backend address: the one saved on the Options page, else the default
 * this build was packaged with. The backend allows the extension via CORS. */
export async function getBackendUrl(): Promise<string> {
  const stored = await chrome.storage.local.get(SERVER_URL_STORAGE_KEY);
  const url = (stored[SERVER_URL_STORAGE_KEY] as string | undefined)?.trim() || DEFAULT_BACKEND_URL;
  return url.replace(/\/+$/, "");
}

export class MissingApiKeyError extends Error {
  constructor() {
    super("No Shortlyst API key saved — set one on the extension's options page.");
  }
}

async function getApiKey(): Promise<string> {
  const stored = await chrome.storage.local.get(API_KEY_STORAGE_KEY);
  const apiKey = stored[API_KEY_STORAGE_KEY] as string | undefined;
  if (!apiKey) {
    throw new MissingApiKeyError();
  }
  return apiKey;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const apiKey = await getApiKey();
  const response = await fetch(`${await getBackendUrl()}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      "x-api-key": apiKey,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${path} failed: ${response.status} ${body}`);
  }

  return response.json() as Promise<T>;
}

export function getRoles(): Promise<RoleSummary[]> {
  return request<RoleSummary[]>("/roles");
}

export function classify(
  candidate: CandidateInput,
  roleId: string,
): Promise<ClassificationResult> {
  return request<ClassificationResult>("/classify", {
    method: "POST",
    body: JSON.stringify({ roleId, candidate }),
  });
}

export function importRoles(
  dimensionRows: string[][],
  mustHaveRows: string[][],
  thresholdRows: string[][],
): Promise<RoleImportSummary> {
  return request<RoleImportSummary>("/roles/import", {
    method: "POST",
    body: JSON.stringify({ dimensionRows, mustHaveRows, thresholdRows }),
  });
}

export function getShortlistedCandidates(): Promise<ShortlistedCandidate[]> {
  return request<ShortlistedCandidate[]>("/candidates/shortlisted");
}

export function getAllCandidates(): Promise<ShortlistedCandidate[]> {
  return request<ShortlistedCandidate[]>("/candidates");
}

export function getRoleDetail(roleId: string): Promise<RoleRequirements> {
  return request<RoleRequirements>(`/roles/${encodeURIComponent(roleId)}`);
}

// ---------- Mail intake (Mailboxes section) ----------

export function getMailProviders(): Promise<MailProviderInfo[]> {
  return request<MailProviderInfo[]>("/mail/providers");
}

export function getMailConnections(): Promise<MailConnectionStatus[]> {
  return request<MailConnectionStatus[]>("/mail/connections");
}

export function getMailThreads(limit = 50): Promise<MailRecentThread[]> {
  return request<MailRecentThread[]>(`/mail/threads?limit=${limit}`);
}

/** The provider's sign-in URL (with a signed, short-lived state) to open in a new tab. */
export function getMailConnectUrl(provider: string): Promise<{ url: string }> {
  return request<{ url: string }>(`/mail/connections/${encodeURIComponent(provider)}/connect-url`, { method: "POST" });
}

export function syncMailbox(connectionId: string): Promise<{ queued: true }> {
  return request<{ queued: true }>(`/mail/connections/${encodeURIComponent(connectionId)}/sync`, { method: "POST" });
}

export function retryFailedMail(): Promise<{ requeued: number }> {
  return request<{ requeued: number }>("/mail/retry-failed", { method: "POST" });
}

export function disconnectMailbox(connectionId: string): Promise<{ deleted: true }> {
  return request<{ deleted: true }>(`/mail/connections/${encodeURIComponent(connectionId)}`, { method: "DELETE" });
}
