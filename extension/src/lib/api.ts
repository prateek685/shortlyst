import type {
  CandidateInput,
  ClassificationResult,
  RoleImportSummary,
  RoleRequirements,
  RoleSummary,
  ShortlistedCandidate,
} from "./types.js";

// Hardcoded — no deployed backend yet, so a configurable URL would be
// solving a problem that doesn't exist. Must match manifest.json's
// host_permissions entry.
const BACKEND_URL = "http://localhost:3000";

export const API_KEY_STORAGE_KEY = "shortlystApiKey";

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
  const response = await fetch(`${BACKEND_URL}${path}`, {
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
