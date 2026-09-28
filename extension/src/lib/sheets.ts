// Google Sheets integration — two independent, one-directional uses, both
// driven client-side via the user's own Google sign-in (chrome.identity):
// importing role criteria (sheet -> our backend, read-only) and exporting
// the shortlisted-candidates list (our backend -> sheet, full replace, not
// append). The backend's service account is retired — neither direction
// goes through it anymore.
//
// The "picker" here (listSpreadsheets) is a small custom list built from
// direct Drive API fetch() calls, not Google's official Picker widget —
// Manifest V3's extension-page CSP blocks loading that widget's remote JS,
// but a fetch() call is just a network request, unaffected by that policy.

import type { ShortlistedCandidate } from "./types.js";

export const CANDIDATES_SHEET_ID_KEY = "shortlystCandidatesSheetId";
export const CANDIDATES_SHEET_NAME_KEY = "shortlystCandidatesSheetName";
export const ROLES_SHEET_ID_KEY = "shortlystRolesSheetId";
export const ROLES_SHEET_NAME_KEY = "shortlystRolesSheetName";

const CANDIDATES_TAB = "Candidates";
const CANDIDATES_HEADER_ROW = [
  "date_added",
  "candidate_name",
  "headline",
  "location",
  "linkedin_url",
  "photo_url",
  "email",
  "phone",
  "role_id",
  "composite_score",
  "composite_confidence",
  "recommendation",
  "needs_review",
  "review_reason",
];

export class GoogleAuthError extends Error {}

// chrome.identity.getAuthToken is callback-based even where other chrome.*
// APIs have gone Promise-first — wrapped once here rather than at every call
// site. `interactive: true` shows a sign-in/consent popup if needed;
// `false` fails silently if the user isn't already connected, used to check
// connection status without prompting.
export function getAuthToken(interactive: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (result) => {
      if (chrome.runtime.lastError || !result) {
        reject(new GoogleAuthError(chrome.runtime.lastError?.message ?? "Google sign-in failed or was cancelled."));
        return;
      }
      // @types/chrome models this as a plain string in some versions and
      // `{ token }` in others depending on the Chrome version's actual
      // callback shape — handle both defensively.
      const token = typeof result === "string" ? result : (result as { token?: string }).token;
      if (!token) {
        reject(new GoogleAuthError("Google sign-in returned no token."));
        return;
      }
      resolve(token);
    });
  });
}

export async function isGoogleConnected(): Promise<boolean> {
  try {
    await getAuthToken(false);
    return true;
  } catch {
    return false;
  }
}

async function googleFetch<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google API request failed: ${response.status} ${body}`);
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}

export interface SpreadsheetSummary {
  id: string;
  name: string;
}

// Lists the user's existing spreadsheets, most-recently-modified first —
// the "browse your sheets" half of the custom picker, shared by both the
// candidates-sheet and roles-sheet pickers.
export async function listSpreadsheets(query: string, token: string): Promise<SpreadsheetSummary[]> {
  const q = [
    "mimeType='application/vnd.google-apps.spreadsheet'",
    "trashed=false",
    ...(query.trim() ? [`name contains '${query.trim().replace(/'/g, "\\'")}'`] : []),
  ].join(" and ");
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&orderBy=modifiedTime desc&pageSize=25`;
  const data = await googleFetch<{ files: SpreadsheetSummary[] }>(url, token);
  return data.files ?? [];
}

// Creates a new spreadsheet with a "Candidates" tab and the agreed header
// row already written. Candidates-sheet only — a freshly created roles
// sheet wouldn't have the Dimensions/MustHaves/Thresholds tab structure
// Import needs, so that picker offers search+select only, no create.
export async function createSpreadsheet(title: string, token: string): Promise<SpreadsheetSummary> {
  const created = await googleFetch<{ spreadsheetId: string; properties: { title: string } }>(
    "https://sheets.googleapis.com/v4/spreadsheets",
    token,
    {
      method: "POST",
      body: JSON.stringify({
        properties: { title },
        sheets: [{ properties: { title: CANDIDATES_TAB } }],
      }),
    },
  );

  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${created.spreadsheetId}/values/${CANDIDATES_TAB}!A1:append?valueInputOption=RAW`,
    token,
    { method: "POST", body: JSON.stringify({ values: [CANDIDATES_HEADER_ROW] }) },
  );

  return { id: created.spreadsheetId, name: created.properties.title };
}

// Raw values for a range, exactly as the Sheets API returns them — used by
// the roles Import flow, which POSTs these straight to the backend for
// parsing (see requirements/roles-import.parser.ts server-side).
export async function fetchSheetRawRows(spreadsheetId: string, range: string, token: string): Promise<string[][]> {
  const data = await googleFetch<{ values?: string[][] }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    token,
  );
  return data.values ?? [];
}

async function clearSheetRange(spreadsheetId: string, range: string, token: string): Promise<void> {
  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`,
    token,
    { method: "POST" },
  );
}

// Replaces the sheet's entire candidate list — clears existing data rows
// (keeping the header) then writes the current full list fresh. This is
// "replace with the current list", not an append-only log: re-running
// Export never grows the sheet, and a candidate that no longer qualifies
// (reclassified away from CONTACT) simply isn't in the next write.
export async function replaceSheetWithCandidates(
  spreadsheetId: string,
  candidates: ShortlistedCandidate[],
  token: string,
): Promise<void> {
  await clearSheetRange(spreadsheetId, `${CANDIDATES_TAB}!A2:N100000`, token);
  if (candidates.length === 0) return;

  const rows = candidates.map((c) => [
    c.classifiedAt,
    c.name ?? "",
    c.headline ?? "",
    c.location ?? "",
    c.linkedinUrl ?? "",
    c.photoUrl ?? "",
    "",
    "",
    c.roleId,
    c.compositeScore,
    c.compositeConfidence ?? "",
    c.recommendation,
    c.needsReview,
    c.reviewReason ?? "",
  ]);

  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${CANDIDATES_TAB}!A2:append?valueInputOption=USER_ENTERED`,
    token,
    { method: "POST", body: JSON.stringify({ values: rows }) },
  );
}
