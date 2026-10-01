import {
  API_KEY_STORAGE_KEY,
  disconnectMailbox,
  getAllCandidates,
  getMailConnections,
  getMailConnectUrl,
  getMailProviders,
  getMailThreads,
  getRoleDetail,
  getRoles,
  getShortlistedCandidates,
  importRoles,
  retryFailedMail,
  syncMailbox,
} from "../lib/api.js";
import {
  CANDIDATES_SHEET_ID_KEY,
  CANDIDATES_SHEET_NAME_KEY,
  ROLES_SHEET_ID_KEY,
  ROLES_SHEET_NAME_KEY,
  createSpreadsheet,
  fetchSheetRawRows,
  getAuthToken,
  isGoogleConnected,
  listSpreadsheets,
  replaceSheetWithCandidates,
} from "../lib/sheets.js";
import type { SpreadsheetSummary } from "../lib/sheets.js";
import type {
  MailConnectionStatus,
  MailOutcome,
  MailRecentThread,
  RoleImportSummary,
  RoleRequirements,
  ShortlistedCandidate,
} from "../lib/types.js";

// ---------- Shortlyst API key ----------

const apiKeyInput = document.getElementById("api-key") as HTMLInputElement;
const apiKeyStatus = document.getElementById("status") as HTMLElement;
const apiKeyForm = document.getElementById("form") as HTMLFormElement;

let apiKeyStatusTimeout: ReturnType<typeof setTimeout> | undefined;

function showApiKeyStatus(message: string): void {
  apiKeyStatus.textContent = message;
  clearTimeout(apiKeyStatusTimeout);
  apiKeyStatusTimeout = setTimeout(() => {
    apiKeyStatus.textContent = "";
  }, 2000);
}

async function loadSavedApiKey(): Promise<void> {
  const stored = await chrome.storage.local.get(API_KEY_STORAGE_KEY);
  const apiKey = stored[API_KEY_STORAGE_KEY] as string | undefined;
  if (apiKey) {
    apiKeyInput.value = apiKey;
  }
}

apiKeyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const apiKey = apiKeyInput.value.trim();
  chrome.storage.local.set({ [API_KEY_STORAGE_KEY]: apiKey }).then(() => {
    showApiKeyStatus(apiKey ? "Saved." : "Cleared.");
  });
});

void loadSavedApiKey();

// Settings (API key) lives in a popover off the header, reachable from every
// section — it's a prerequisite for everything else, not a "Sheet" concern.
const settingsToggleEl = document.getElementById("settings-toggle") as HTMLButtonElement;
const settingsPopoverEl = document.getElementById("settings-popover") as HTMLElement;

settingsToggleEl.addEventListener("click", (event) => {
  event.stopPropagation();
  settingsPopoverEl.hidden = !settingsPopoverEl.hidden;
});
document.addEventListener("click", (event) => {
  if (!settingsPopoverEl.hidden && !settingsPopoverEl.contains(event.target as Node) && event.target !== settingsToggleEl) {
    settingsPopoverEl.hidden = true;
  }
});

// ---------- Reusable Google Sheets picker ----------
// One picker implementation shared by the "Shortlisted Candidates" and
// "Roles & Criteria" cards — same search/list/select behaviour, just wired
// to different DOM ids and storage keys.

interface PickerConfig {
  idSuffix: "candidates" | "roles";
  storageIdKey: string;
  storageNameKey: string;
  allowCreate: boolean;
  onSelectionChange: (sheetId: string | undefined) => void;
}

function setupPicker(config: PickerConfig) {
  const selectedEl = document.getElementById(`selected-sheet-${config.idSuffix}`) as HTMLElement;
  const searchEl = document.getElementById(`sheet-search-${config.idSuffix}`) as HTMLInputElement;
  const listEl = document.getElementById(`sheet-list-${config.idSuffix}`) as HTMLElement;
  const newNameEl = config.allowCreate
    ? (document.getElementById(`new-sheet-name-${config.idSuffix}`) as HTMLInputElement)
    : null;
  const createButtonEl = config.allowCreate
    ? (document.getElementById(`create-sheet-button-${config.idSuffix}`) as HTMLButtonElement)
    : null;

  let searchDebounce: ReturnType<typeof setTimeout> | undefined;

  function showListError(message: string): void {
    listEl.replaceChildren();
    const row = document.createElement("div");
    row.className = "sheet-row-empty";
    row.textContent = message;
    listEl.appendChild(row);
  }

  async function renderSelected(): Promise<void> {
    const stored = await chrome.storage.local.get([config.storageIdKey, config.storageNameKey]);
    const id = stored[config.storageIdKey] as string | undefined;
    const name = stored[config.storageNameKey] as string | undefined;
    config.onSelectionChange(id);

    if (!id) {
      selectedEl.hidden = true;
      return;
    }
    selectedEl.hidden = false;
    selectedEl.replaceChildren();
    const label = document.createElement("span");
    label.textContent = name ?? id;
    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "secondary-button";
    clearButton.textContent = "Change";
    clearButton.addEventListener("click", async () => {
      await chrome.storage.local.remove([config.storageIdKey, config.storageNameKey]);
      await renderSelected();
    });
    selectedEl.append(label, clearButton);
  }

  async function select(sheet: SpreadsheetSummary): Promise<void> {
    await chrome.storage.local.set({
      [config.storageIdKey]: sheet.id,
      [config.storageNameKey]: sheet.name,
    });
    await renderSelected();
  }

  function renderList(sheets: SpreadsheetSummary[]): void {
    listEl.replaceChildren();
    if (sheets.length === 0) {
      showListError("No spreadsheets found.");
      return;
    }
    for (const sheet of sheets) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "sheet-row";
      row.textContent = sheet.name;
      row.addEventListener("click", () => void select(sheet));
      listEl.appendChild(row);
    }
  }

  async function refreshList(query = ""): Promise<void> {
    try {
      const token = await getAuthToken(false);
      const sheets = await listSpreadsheets(query, token);
      renderList(sheets);
    } catch (err) {
      showListError(`Couldn't load spreadsheets: ${(err as Error).message}`);
    }
  }

  searchEl.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => void refreshList(searchEl.value), 300);
  });

  if (createButtonEl && newNameEl) {
    createButtonEl.addEventListener("click", async () => {
      const name = newNameEl.value.trim();
      if (!name) return;
      createButtonEl.disabled = true;
      try {
        const token = await getAuthToken(true);
        const sheet = await createSpreadsheet(name, token);
        newNameEl.value = "";
        await select(sheet);
        await refreshList(searchEl.value);
      } catch (err) {
        showListError(`Couldn't create spreadsheet: ${(err as Error).message}`);
      } finally {
        createButtonEl.disabled = false;
      }
    });
  }

  return { renderSelected, refreshList };
}

let candidatesSheetId: string | undefined;
let rolesSheetId: string | undefined;

const exportButtonEl = document.getElementById("export-button") as HTMLButtonElement;
const exportStatusEl = document.getElementById("export-status") as HTMLElement;
const importButtonEl = document.getElementById("import-button") as HTMLButtonElement;
const importStatusEl = document.getElementById("import-status") as HTMLElement;
const importSummaryEl = document.getElementById("import-summary") as HTMLElement;

const candidatesPicker = setupPicker({
  idSuffix: "candidates",
  storageIdKey: CANDIDATES_SHEET_ID_KEY,
  storageNameKey: CANDIDATES_SHEET_NAME_KEY,
  allowCreate: true,
  onSelectionChange: (id) => {
    candidatesSheetId = id;
    exportButtonEl.disabled = !id;
  },
});

const rolesPicker = setupPicker({
  idSuffix: "roles",
  storageIdKey: ROLES_SHEET_ID_KEY,
  storageNameKey: ROLES_SHEET_NAME_KEY,
  allowCreate: false,
  onSelectionChange: (id) => {
    rolesSheetId = id;
    importButtonEl.disabled = !id;
  },
});

function setStatus(el: HTMLElement, message: string, isError = false): void {
  el.textContent = message;
  el.style.color = isError ? "var(--danger-text)" : "var(--success-text)";
}

exportButtonEl.addEventListener("click", async () => {
  if (!candidatesSheetId) return;
  exportButtonEl.disabled = true;
  exportStatusEl.textContent = "Exporting…";
  exportStatusEl.style.color = "";
  try {
    const token = await getAuthToken(true);
    const candidates = await getShortlistedCandidates();
    await replaceSheetWithCandidates(candidatesSheetId, candidates, token);
    setStatus(exportStatusEl, `Exported ${candidates.length} candidate${candidates.length === 1 ? "" : "s"}.`);
  } catch (err) {
    setStatus(exportStatusEl, `Export failed: ${(err as Error).message}`, true);
  } finally {
    exportButtonEl.disabled = !candidatesSheetId;
  }
});

function renderImportSummary(summary: RoleImportSummary): void {
  importSummaryEl.replaceChildren();
  if (summary.imported.length > 0) {
    const p = document.createElement("p");
    p.textContent = `Imported: ${summary.imported.join(", ")}`;
    importSummaryEl.appendChild(p);
  }
  if (summary.skipped.length > 0) {
    const p = document.createElement("p");
    p.textContent = "Skipped:";
    const ul = document.createElement("ul");
    for (const s of summary.skipped) {
      const li = document.createElement("li");
      li.textContent = `${s.roleId}: ${s.reason}`;
      ul.appendChild(li);
    }
    importSummaryEl.append(p, ul);
  }
}

importButtonEl.addEventListener("click", async () => {
  if (!rolesSheetId) return;
  importButtonEl.disabled = true;
  importStatusEl.textContent = "Importing…";
  importStatusEl.style.color = "";
  importSummaryEl.replaceChildren();
  try {
    const token = await getAuthToken(true);
    const [dimensionRows, mustHaveRows, thresholdRows] = await Promise.all([
      fetchSheetRawRows(rolesSheetId, "Dimensions!A:J", token),
      fetchSheetRawRows(rolesSheetId, "MustHaves!A:C", token),
      fetchSheetRawRows(rolesSheetId, "Thresholds!A:E", token),
    ]);
    const summary = await importRoles(dimensionRows, mustHaveRows, thresholdRows);
    setStatus(importStatusEl, `Imported ${summary.imported.length} role${summary.imported.length === 1 ? "" : "s"}.`);
    renderImportSummary(summary);
  } catch (err) {
    setStatus(importStatusEl, `Import failed: ${(err as Error).message}`, true);
  } finally {
    importButtonEl.disabled = !rolesSheetId;
  }
});

// ---------- Google Account (shared connect banner) ----------

const googleDisconnectedEl = document.getElementById("google-disconnected") as HTMLElement;
const googleConnectedEl = document.getElementById("google-connected") as HTMLElement;
const connectButtonEl = document.getElementById("connect-google-button") as HTMLButtonElement;
const googleStatusEl = document.getElementById("google-status") as HTMLElement;

async function refreshGoogleConnectionUI(): Promise<void> {
  const connected = await isGoogleConnected();
  googleDisconnectedEl.hidden = connected;
  googleConnectedEl.hidden = !connected;
  if (connected) {
    await candidatesPicker.refreshList();
    await rolesPicker.refreshList();
  }
}

connectButtonEl.addEventListener("click", async () => {
  connectButtonEl.disabled = true;
  googleStatusEl.textContent = "";
  try {
    await getAuthToken(true);
    await refreshGoogleConnectionUI();
  } catch (err) {
    googleStatusEl.textContent = (err as Error).message;
    googleStatusEl.style.color = "var(--danger-text)";
  } finally {
    connectButtonEl.disabled = false;
  }
});

void (async () => {
  await candidatesPicker.renderSelected();
  await rolesPicker.renderSelected();
  await refreshGoogleConnectionUI();
})();

// ---------- Candidates section ----------

const candidatesStatusEl = document.getElementById("candidates-status") as HTMLElement;
const candidatesTbodyEl = document.getElementById("candidates-tbody") as HTMLElement;

function recommendationBadge(recommendation: string): HTMLElement {
  const span = document.createElement("span");
  span.className = `recommendation recommendation-${recommendation}`;
  span.textContent = recommendation.toUpperCase();
  return span;
}

function candidateNameCell(candidate: ShortlistedCandidate): HTMLElement {
  const cell = document.createElement("div");
  cell.className = "candidate-name-cell";

  if (candidate.photoUrl) {
    const img = document.createElement("img");
    img.className = "candidate-photo";
    img.src = candidate.photoUrl;
    img.alt = "";
    cell.appendChild(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "candidate-photo-placeholder";
    placeholder.textContent = (candidate.name ?? "?").trim().charAt(0).toUpperCase() || "?";
    cell.appendChild(placeholder);
  }

  const textWrap = document.createElement("div");
  const nameLine = document.createElement("div");
  nameLine.className = "candidate-name";
  nameLine.textContent = candidate.name ?? "(no name captured)";
  const sourceBadge = document.createElement("span");
  sourceBadge.className = "source-badge";
  sourceBadge.textContent = candidate.source === "email" ? "Email" : candidate.source === "linkedin" ? "LinkedIn" : candidate.source;
  nameLine.appendChild(sourceBadge);

  const headlineLine = document.createElement("div");
  headlineLine.className = "candidate-headline";
  headlineLine.textContent = candidate.headline ?? "";
  textWrap.append(nameLine, headlineLine);

  if (candidate.email || candidate.emailLink || candidate.linkedinUrl) {
    const links = document.createElement("div");
    links.className = "candidate-headline";
    if (candidate.email) links.append(candidate.email);
    const href = candidate.emailLink ?? candidate.linkedinUrl;
    if (href) {
      const link = document.createElement("a");
      link.className = "table-link";
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = candidate.emailLink ? "Open email ↗" : "LinkedIn ↗";
      if (candidate.email) links.append(" · ");
      links.append(link);
    }
    textWrap.appendChild(links);
  }
  cell.appendChild(textWrap);

  return cell;
}

async function renderCandidates(): Promise<void> {
  candidatesStatusEl.textContent = "Loading…";
  candidatesStatusEl.style.color = "";
  candidatesTbodyEl.replaceChildren();
  try {
    const candidates = await getAllCandidates();
    candidatesStatusEl.textContent = candidates.length === 0 ? "No candidates scanned yet." : "";

    for (const candidate of candidates) {
      const row = document.createElement("tr");

      const nameTd = document.createElement("td");
      nameTd.appendChild(candidateNameCell(candidate));

      const roleTd = document.createElement("td");
      roleTd.textContent = candidate.roleId;

      const scoreTd = document.createElement("td");
      scoreTd.textContent = candidate.compositeScore.toFixed(2);

      const recTd = document.createElement("td");
      recTd.appendChild(recommendationBadge(candidate.recommendation));

      const dateTd = document.createElement("td");
      dateTd.textContent = formatDateTime(candidate.classifiedAt);

      row.append(nameTd, roleTd, scoreTd, recTd, dateTd);
      candidatesTbodyEl.appendChild(row);
    }
  } catch (err) {
    candidatesStatusEl.textContent = `Couldn't load candidates: ${(err as Error).message}`;
    candidatesStatusEl.style.color = "var(--danger-text)";
  }
}

// ---------- Roles section ----------

const roleListEl = document.getElementById("role-list") as HTMLElement;
const roleDetailEl = document.getElementById("role-detail") as HTMLElement;

function renderRoleDetail(role: RoleRequirements): void {
  roleDetailEl.replaceChildren();

  const thresholds = document.createElement("p");
  thresholds.className = "hint";
  thresholds.style.marginBottom = "1rem";
  thresholds.textContent = `Contact ≥ ${role.thresholds.contact} · Reject ≤ ${role.thresholds.reject} · Confidence floor ${role.thresholds.confidenceFloor}`;
  roleDetailEl.appendChild(thresholds);

  for (const dimension of role.dimensions) {
    const row = document.createElement("div");
    row.className = "dimension-row";

    const title = document.createElement("div");
    title.className = "dimension-title";
    title.textContent = `${dimension.id} — weight ${dimension.weight}`;

    const instructions = document.createElement("div");
    instructions.className = "dimension-instructions";
    instructions.textContent = dimension.instructions;

    const levels = document.createElement("div");
    levels.className = "dimension-levels";
    levels.textContent = dimension.levels.join(" → ");

    row.append(title, instructions, levels);
    roleDetailEl.appendChild(row);
  }

  if (role.mustHaves.length > 0) {
    const mustHaveTitle = document.createElement("p");
    mustHaveTitle.className = "card-title";
    mustHaveTitle.style.marginTop = "1.25rem";
    mustHaveTitle.textContent = "Must-haves";
    roleDetailEl.appendChild(mustHaveTitle);

    for (const mustHave of role.mustHaves) {
      const row = document.createElement("div");
      row.className = "dimension-row";
      row.textContent = mustHave.instructions;
      roleDetailEl.appendChild(row);
    }
  }
}

async function selectRole(roleId: string): Promise<void> {
  for (const item of roleListEl.querySelectorAll<HTMLButtonElement>(".role-list-item")) {
    item.classList.toggle("active", item.dataset.roleId === roleId);
  }

  roleDetailEl.replaceChildren();
  const loading = document.createElement("p");
  loading.className = "hint";
  loading.textContent = "Loading…";
  roleDetailEl.appendChild(loading);

  try {
    const role = await getRoleDetail(roleId);
    renderRoleDetail(role);
  } catch (err) {
    roleDetailEl.replaceChildren();
    const error = document.createElement("p");
    error.style.color = "var(--danger-text)";
    error.textContent = `Couldn't load role: ${(err as Error).message}`;
    roleDetailEl.appendChild(error);
  }
}

async function renderRoleList(): Promise<void> {
  roleListEl.replaceChildren();
  roleDetailEl.replaceChildren();
  try {
    const roles = await getRoles();
    if (roles.length === 0) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.style.padding = "1rem";
      empty.textContent = "No roles imported yet — import some from the Sheet section.";
      roleListEl.appendChild(empty);
      return;
    }

    for (const role of roles) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "role-list-item";
      button.textContent = role.roleId;
      button.dataset.roleId = role.roleId;
      button.addEventListener("click", () => void selectRole(role.roleId));
      roleListEl.appendChild(button);
    }

    await selectRole(roles[0]!.roleId);
  } catch (err) {
    const error = document.createElement("p");
    error.style.color = "var(--danger-text)";
    error.style.padding = "1rem";
    error.textContent = `Couldn't load roles: ${(err as Error).message}`;
    roleListEl.appendChild(error);
  }
}

// ---------- Mailboxes section ----------
// Provider-neutral: lists whatever providers the backend has configured and
// shows each connection's processing state. Refreshes every few seconds while
// the section is open, so a backlog can be watched draining.

const mailboxListEl = document.getElementById("mailbox-list") as HTMLElement;
const mailboxConnectEl = document.getElementById("mailbox-connect") as HTMLElement;
const mailboxStatusEl = document.getElementById("mailbox-status") as HTMLElement;
const mailStatsEl = document.getElementById("mail-stats") as HTMLElement;
const mailLagEl = document.getElementById("mail-lag") as HTMLElement;
const mailRetryButtonEl = document.getElementById("mail-retry-button") as HTMLButtonElement;
const mailThreadsStatusEl = document.getElementById("mail-threads-status") as HTMLElement;
const mailThreadsTbodyEl = document.getElementById("mail-threads-tbody") as HTMLElement;

const MAILBOX_REFRESH_MS = 5000;
const LAG_WARNING_SECONDS = 30 * 60;
let mailboxRefreshTimer: ReturnType<typeof setInterval> | undefined;
let providerNames: Record<string, string> = {};
/** Sync now clicks still waiting for their check to finish: connection id →
 * its last-checked time and email total at the time of the click. */
const pendingSyncs = new Map<string, { lastSyncAt: string | null; total: number }>();

const emailTotal = (c: MailConnectionStatus) => Object.values(c.counts).reduce((sum, n) => sum + n, 0);

// A finished check moves lastSyncAt; that's when "Checking…" gets its result.
function reportFinishedSyncs(connections: MailConnectionStatus[]): void {
  for (const [id, before] of pendingSyncs) {
    const connection = connections.find((c) => c.id === id);
    if (!connection) {
      pendingSyncs.delete(id);
      continue;
    }
    if (connection.lastSyncAt === before.lastSyncAt) continue;
    pendingSyncs.delete(id);
    const found = emailTotal(connection) - before.total;
    const result = found > 0 ? `${found} new email${found === 1 ? "" : "s"} found` : "No new emails";
    setStatus(mailboxStatusEl, `Checked ${connection.mailbox}. ${result}.`);
  }
}

const OUTCOME_LABELS: Record<MailOutcome, string> = {
  contact: "Contact",
  maybe: "Maybe",
  reject: "Reject",
  needs_review: "Needs review",
  not_candidate: "Not a candidate",
};

// 12-hour clock with AM/PM on every timestamp, whatever the browser locale.
function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, { hour12: true });
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

function mailboxRow(connection: MailConnectionStatus): HTMLElement {
  const row = document.createElement("div");
  row.className = "mailbox-row";

  const info = document.createElement("div");
  const address = document.createElement("div");
  address.className = "mailbox-address";
  address.textContent = connection.mailbox;
  const pill = document.createElement("span");
  pill.className = `status-pill status-${connection.status}`;
  pill.textContent = connection.status === "connected" ? "Connected" : "Disconnected";
  address.appendChild(pill);

  const meta = document.createElement("div");
  meta.className = "mailbox-meta";
  const provider = providerNames[connection.provider] ?? connection.provider;
  const lastSync = connection.lastSyncAt ? `last checked ${formatDateTime(connection.lastSyncAt)}` : "not checked yet";
  meta.textContent = `${provider} · ${lastSync}`;
  info.append(address, meta);
  if (connection.lastError) {
    const error = document.createElement("div");
    error.className = "mailbox-meta";
    error.style.color = "var(--danger-text)";
    error.textContent = connection.status === "disconnected" ? `${connection.lastError} — reconnect to resume.` : connection.lastError;
    info.appendChild(error);
  }

  const actions = document.createElement("div");
  actions.className = "mailbox-actions";

  if (connection.status === "disconnected") {
    const reconnect = document.createElement("button");
    reconnect.type = "button";
    reconnect.className = "primary-button";
    reconnect.textContent = "Reconnect";
    reconnect.addEventListener("click", () => void startConnect(connection.provider));
    actions.appendChild(reconnect);
  } else {
    const sync = document.createElement("button");
    sync.type = "button";
    sync.className = "secondary-button";
    sync.textContent = "Sync now";
    sync.addEventListener("click", async () => {
      sync.disabled = true;
      try {
        pendingSyncs.set(connection.id, { lastSyncAt: connection.lastSyncAt, total: emailTotal(connection) });
        await syncMailbox(connection.id);
        setStatus(mailboxStatusEl, `Checking ${connection.mailbox} now…`);
      } catch (err) {
        pendingSyncs.delete(connection.id);
        setStatus(mailboxStatusEl, `Sync failed: ${(err as Error).message}`, true);
      } finally {
        sync.disabled = false;
      }
    });
    actions.appendChild(sync);
  }

  const disconnect = document.createElement("button");
  disconnect.type = "button";
  disconnect.className = "secondary-button";
  disconnect.textContent = "Disconnect";
  disconnect.addEventListener("click", async () => {
    if (disconnect.dataset.confirm !== "yes") {
      disconnect.dataset.confirm = "yes";
      disconnect.textContent = "Click again to disconnect";
      return;
    }
    disconnect.disabled = true;
    try {
      await disconnectMailbox(connection.id);
      setStatus(mailboxStatusEl, `${connection.mailbox} disconnected.`);
      await renderMailboxes();
    } catch (err) {
      setStatus(mailboxStatusEl, `Disconnect failed: ${(err as Error).message}`, true);
      disconnect.disabled = false;
    }
  });
  actions.appendChild(disconnect);

  row.append(info, actions);
  return row;
}

async function startConnect(provider: string): Promise<void> {
  try {
    const { url } = await getMailConnectUrl(provider);
    await chrome.tabs.create({ url });
    setStatus(mailboxStatusEl, "Finish signing in in the new tab — this page updates once it's connected.");
  } catch (err) {
    setStatus(mailboxStatusEl, `Couldn't start connecting: ${(err as Error).message}`, true);
  }
}

function renderStats(connections: MailConnectionStatus[]): void {
  const totals = { queued: 0, processing: 0, failed: 0, done: 0, skipped: 0 };
  let oldestWaiting: number | null = null;
  for (const c of connections) {
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += c.counts[key];
    if (c.oldestWaitingSeconds !== null) oldestWaiting = Math.max(oldestWaiting ?? 0, c.oldestWaitingSeconds);
  }

  const stats: [string, number, boolean][] = [
    ["Waiting", totals.queued, false],
    ["Processing", totals.processing, false],
    ["Failed", totals.failed, totals.failed > 0],
    ["Classified", totals.done, false],
    ["Skipped", totals.skipped, false],
  ];
  mailStatsEl.replaceChildren(
    ...stats.map(([label, value, warn]) => {
      const stat = document.createElement("div");
      stat.className = warn ? "stat stat-warning" : "stat";
      const v = document.createElement("div");
      v.className = "stat-value";
      v.textContent = String(value);
      const l = document.createElement("div");
      l.className = "stat-label";
      l.textContent = label;
      stat.append(v, l);
      return stat;
    }),
  );

  mailRetryButtonEl.disabled = totals.failed === 0;
  if (oldestWaiting === null) {
    mailLagEl.textContent = totals.done + totals.skipped > 0 ? "All caught up." : "";
    mailLagEl.style.color = "var(--success-text)";
  } else {
    mailLagEl.textContent = `Oldest waiting email: ${formatAge(oldestWaiting)}`;
    mailLagEl.style.color = oldestWaiting > LAG_WARNING_SECONDS ? "var(--danger-text)" : "var(--text-muted)";
  }
}

function outcomeCell(thread: MailRecentThread): HTMLElement {
  const td = document.createElement("td");
  if (thread.status === "failed") {
    td.textContent = "Failed";
    td.style.color = "var(--danger-text)";
  } else if (thread.status !== "done" || !thread.outcome) {
    td.textContent = thread.status === "processing" ? "Processing…" : "Waiting…";
    td.style.color = "var(--text-muted)";
  } else {
    const badge = document.createElement("span");
    badge.className = `recommendation recommendation-${thread.outcome}`;
    badge.textContent = OUTCOME_LABELS[thread.outcome];
    td.appendChild(badge);
  }
  return td;
}

function renderThreads(threads: MailRecentThread[]): void {
  mailThreadsTbodyEl.replaceChildren();
  mailThreadsStatusEl.textContent = threads.length === 0 ? "No emails processed yet." : "";
  mailThreadsStatusEl.style.color = "";
  for (const thread of threads) {
    const row = document.createElement("tr");

    const fromTd = document.createElement("td");
    const fromName = document.createElement("div");
    fromName.className = "candidate-name";
    fromName.textContent = thread.fromName ?? thread.fromEmail ?? "—";
    const fromEmail = document.createElement("div");
    fromEmail.className = "candidate-headline";
    fromEmail.textContent = thread.fromName ? (thread.fromEmail ?? "") : "";
    fromTd.append(fromName, fromEmail);

    const subjectTd = document.createElement("td");
    const subject = document.createElement("div");
    subject.className = "thread-subject";
    subject.textContent = thread.subject ?? "(fetching…)";
    subjectTd.appendChild(subject);
    if (thread.reason) {
      const reason = document.createElement("div");
      reason.className = "thread-reason";
      reason.textContent = thread.reason;
      subjectTd.appendChild(reason);
    }

    const receivedTd = document.createElement("td");
    receivedTd.textContent = thread.receivedAt ? formatDateTime(thread.receivedAt) : "—";

    const roleTd = document.createElement("td");
    roleTd.textContent = thread.roleId ?? "—";

    const linkTd = document.createElement("td");
    if (thread.link) {
      const link = document.createElement("a");
      link.className = "table-link";
      link.href = thread.link;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Open email ↗";
      linkTd.appendChild(link);
    }

    row.append(fromTd, subjectTd, receivedTd, outcomeCell(thread), roleTd, linkTd);
    mailThreadsTbodyEl.appendChild(row);
  }
}

async function renderMailboxes(): Promise<void> {
  try {
    const [providers, connections, threads] = await Promise.all([
      getMailProviders(),
      getMailConnections(),
      getMailThreads(50),
    ]);
    providerNames = Object.fromEntries(providers.map((p) => [p.type, p.displayName]));

    mailboxListEl.replaceChildren(...connections.map(mailboxRow));
    reportFinishedSyncs(connections);
    if (connections.length === 0) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "No mailbox connected yet.";
      mailboxListEl.appendChild(empty);
    }

    mailboxConnectEl.replaceChildren();
    const available = providers.filter((p) => p.configured);
    for (const provider of available) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "primary-button";
      button.textContent = `Connect ${provider.displayName}`;
      button.addEventListener("click", () => void startConnect(provider.type));
      mailboxConnectEl.appendChild(button);
    }
    if (available.length === 0) {
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = "No mail provider is configured on the backend yet (e.g. GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET in .env).";
      mailboxConnectEl.appendChild(hint);
    }

    renderStats(connections);
    renderThreads(threads);
  } catch (err) {
    mailThreadsStatusEl.textContent = `Couldn't load mailboxes: ${(err as Error).message}`;
    mailThreadsStatusEl.style.color = "var(--danger-text)";
  }
}

mailRetryButtonEl.addEventListener("click", async () => {
  mailRetryButtonEl.disabled = true;
  try {
    const { requeued } = await retryFailedMail();
    setStatus(mailLagEl, `Retrying ${requeued} email${requeued === 1 ? "" : "s"}…`);
    await renderMailboxes();
  } catch (err) {
    setStatus(mailLagEl, `Retry failed: ${(err as Error).message}`, true);
  }
});

function startMailboxesRefresh(): void {
  void renderMailboxes();
  clearInterval(mailboxRefreshTimer);
  mailboxRefreshTimer = setInterval(() => void renderMailboxes(), MAILBOX_REFRESH_MS);
}

function stopMailboxesRefresh(): void {
  clearInterval(mailboxRefreshTimer);
  mailboxRefreshTimer = undefined;
}

// ---------- Sidebar navigation ----------

const navItems = document.querySelectorAll<HTMLButtonElement>(".nav-item");
const sections: Record<string, HTMLElement> = {
  candidates: document.getElementById("section-candidates") as HTMLElement,
  roles: document.getElementById("section-roles") as HTMLElement,
  mailboxes: document.getElementById("section-mailboxes") as HTMLElement,
  sheet: document.getElementById("section-sheet") as HTMLElement,
};

function showSection(name: string): void {
  for (const [key, el] of Object.entries(sections)) {
    el.hidden = key !== name;
  }
  for (const item of navItems) {
    item.classList.toggle("active", item.dataset.section === name);
  }
  if (name === "candidates") void renderCandidates();
  if (name === "roles") void renderRoleList();
  if (name === "mailboxes") startMailboxesRefresh();
  else stopMailboxesRefresh();
}

for (const item of navItems) {
  item.addEventListener("click", () => showSection(item.dataset.section!));
}

showSection("candidates");
