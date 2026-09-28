import {
  API_KEY_STORAGE_KEY,
  getAllCandidates,
  getRoleDetail,
  getRoles,
  getShortlistedCandidates,
  importRoles,
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
import type { RoleImportSummary, RoleRequirements, ShortlistedCandidate } from "../lib/types.js";

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
      fetchSheetRawRows(rolesSheetId, "Thresholds!A:D", token),
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
  const headlineLine = document.createElement("div");
  headlineLine.className = "candidate-headline";
  headlineLine.textContent = candidate.headline ?? "";
  textWrap.append(nameLine, headlineLine);
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
      dateTd.textContent = new Date(candidate.classifiedAt).toLocaleString();

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

// ---------- Sidebar navigation ----------

const navItems = document.querySelectorAll<HTMLButtonElement>(".nav-item");
const sections: Record<string, HTMLElement> = {
  candidates: document.getElementById("section-candidates") as HTMLElement,
  roles: document.getElementById("section-roles") as HTMLElement,
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
}

for (const item of navItems) {
  item.addEventListener("click", () => showSection(item.dataset.section!));
}

showSection("candidates");
