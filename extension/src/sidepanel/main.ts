import { classify, getRoles, MissingApiKeyError } from "../lib/api.js";
import { READ_PAGE_TEXT } from "../lib/messages.js";
import type { ReadPageTextResponse } from "../lib/messages.js";
import type { ProfilePreview } from "../lib/types.js";
import { renderProfileHeader, renderResult, renderSections, renderStepper } from "./ui.js";
import type { StepInfo } from "./ui.js";

const profileHeaderContainer = document.getElementById("profile-header-container") as HTMLElement;
const scanButtonEl = document.getElementById("scan-button") as HTMLButtonElement;
const stopButtonEl = document.getElementById("stop-button") as HTMLButtonElement;
const stepperContainer = document.getElementById("stepper-container") as HTMLElement;
const scanStatusEl = document.getElementById("scan-status") as HTMLElement;
const sectionsContainer = document.getElementById("sections-container") as HTMLElement;
const roleSelectEl = document.getElementById("role-select") as HTMLSelectElement;
const classifyButtonEl = document.getElementById("classify-button") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLElement;
const resultEl = document.getElementById("result") as HTMLElement;
const optionsButtonEl = document.getElementById("options-link") as HTMLButtonElement;
const resetButtonEl = document.getElementById("reset-button") as HTMLButtonElement;

// `enabled: false` skips a step's page load entirely without removing its
// extraction logic. Education is off for now: no current role criterion
// uses it, so it cost a full page load plus Jev input tokens for nothing —
// flip it back on once a role needs it.
const ALL_DETAIL_STEPS: {
  suffix: string;
  label: string;
  key: "about" | "experience" | "education" | "skills";
  enabled: boolean;
}[] = [
  { suffix: "", label: "Profile", key: "about", enabled: true },
  { suffix: "details/experience/", label: "Experience", key: "experience", enabled: true },
  { suffix: "details/education/", label: "Education", key: "education", enabled: false },
  { suffix: "details/skills/", label: "Skills", key: "skills", enabled: true },
];
const DETAIL_STEPS = ALL_DETAIL_STEPS.filter((step) => step.enabled);
// Side panel only shows cards for sections the scan actually reads.
const VISIBLE_SECTION_KEYS = DETAIL_STEPS.map((step) => step.key);

// Classify automatically at the end of every scan. Set to false to pause
// Jev calls (e.g. while testing scraping changes) — the Classify button
// still works for a manual run.
const AUTO_CLASSIFY = true;

let currentProfile: ProfilePreview | null = null;
let scanning = false;
let cancelled = false;

optionsButtonEl.addEventListener("click", () => chrome.runtime.openOptionsPage());

function showStatus(message: string, isError = false): void {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
  statusEl.hidden = false;
}

function clearStatus(): void {
  statusEl.hidden = true;
}

function setStepper(steps: StepInfo[]): void {
  renderStepper(stepperContainer, steps);
}

function setScanning(isScanning: boolean): void {
  scanning = isScanning;
  scanButtonEl.hidden = isScanning;
  stopButtonEl.hidden = !isScanning;
  resetButtonEl.hidden = isScanning;
}

// Clears the panel back to its idle state — used both by the manual Reset
// button and by the automatic "you're on a different profile now" guard.
// Never touches an in-progress scan; Stop handles that case.
function resetPanel(): void {
  currentProfile = null;
  renderProfileHeader(profileHeaderContainer, null);
  renderSections(sectionsContainer, null);
  resultEl.hidden = true;
  setStepper([]);
  scanStatusEl.hidden = true;
  clearStatus();
  classifyButtonEl.disabled = true;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function baseProfileUrl(url: string): string {
  const withoutQuery = url.split("?")[0]!;
  return withoutQuery.replace(/\/details\/[^/]+\/?$/, "").replace(/\/$/, "") + "/";
}

function waitForTabComplete(tabId: number, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    function listener(updatedTabId: number, info: chrome.tabs.OnUpdatedInfo): void {
      if (updatedTabId === tabId && info.status === "complete") finish();
    }
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(finish, timeoutMs); // safety net in case "complete" never fires
  });
}

// Right after a navigation, the content script may not have (re-)registered
// its listener yet — a couple of short retries covers that gap.
async function readPage(tabId: number, attempts = 3): Promise<ReadPageTextResponse> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = (await chrome.tabs.sendMessage(tabId, { type: READ_PAGE_TEXT })) as
        | ReadPageTextResponse
        | undefined;
      if (response) return response;
    } catch {
      // not ready yet — retry shortly
    }
    if (attempt < attempts - 1) await delay(500); // no pause after the final attempt
  }
  throw new Error("the page never responded");
}

// Reads the already-loaded profile page without reloading it. The manifest
// only injects the content script on a full page load of /in/*, so it's
// missing when the profile was reached by clicking through LinkedIn (search,
// feed — in-app navigation, no page load) or the tab predates an extension
// reload. In that case it's injected on the spot — our own bundled file
// only, never remote code — instead of paying for a reload plus LinkedIn's
// ~2.7 s re-render (measured live). One quick probe, not the usual retries:
// the page is already loaded, so no answer means no listener, not "not yet".
// Returns undefined when the page still shows a different profile than the
// URL (mid-navigation) or can't be read — the caller then reloads instead.
async function readInPlace(tabId: number): Promise<ReadPageTextResponse | undefined> {
  let response = await readPage(tabId, 1).catch(() => undefined);
  if (!response) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["dist/content/page-reader.js"] });
      response = await readPage(tabId);
    } catch {
      return undefined;
    }
  }
  return response.matchesUrl === false ? undefined : response;
}

// Empty sections (a disabled step, or a candidate with no About) are left
// out entirely rather than sent as a bare heading — every line is paid-for
// Jev input.
function buildProfileText(profile: ProfilePreview): string {
  const sections: [string, string][] = [
    ["About", profile.about],
    ["Experience", profile.experience],
    ["Education", profile.education],
    ["Skills", profile.skills],
  ];
  return [
    `Headline: ${profile.headline ?? ""}`,
    ...sections.filter(([, text]) => text.trim()).map(([heading, text]) => `\n${heading}:\n${text}`),
  ].join("\n");
}

async function classifyCurrentProfile(): Promise<void> {
  if (!currentProfile) return;
  const roleId = roleSelectEl.value;
  if (!roleId) {
    showStatus("No role selected — pick one and click Reclassify.", true);
    return;
  }
  classifyButtonEl.disabled = true;
  try {
    const result = await classify(
      {
        source: "linkedin",
        externalId: currentProfile.profileUrl,
        profileText: buildProfileText(currentProfile),
        name: currentProfile.name,
        headline: currentProfile.headline,
        location: currentProfile.location,
        photoUrl: currentProfile.photoUrl,
      },
      roleId,
    );
    clearStatus();
    renderResult(resultEl, result);
  } catch (err) {
    showStatus(
      err instanceof MissingApiKeyError
        ? "No API key set — open the settings (⚙) to add one."
        : `Classification failed: ${(err as Error).message}`,
      true,
    );
  } finally {
    classifyButtonEl.disabled = roleSelectEl.options.length === 0 || !currentProfile;
  }
}

async function runScan(): Promise<void> {
  if (scanning) return;
  cancelled = false;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.includes("linkedin.com/in/")) {
    showStatus("Open a LinkedIn profile page in this tab first.", true);
    return;
  }
  const tabId = tab.id;
  const baseUrl = baseProfileUrl(tab.url);

  currentProfile = null;
  renderProfileHeader(profileHeaderContainer, null);
  renderSections(sectionsContainer, null);
  resultEl.hidden = true;
  clearStatus();

  const steps: StepInfo[] = DETAIL_STEPS.map((s) => ({ label: s.label, status: "pending" }));
  setStepper(steps);
  setScanning(true);
  scanStatusEl.hidden = false;

  try {
    for (let i = 0; i < DETAIL_STEPS.length; i++) {
      if (cancelled) {
        scanStatusEl.textContent = "Stopped.";
        return;
      }
      steps[i]!.status = "active";
      setStepper(steps);
      scanStatusEl.textContent = `Reading ${DETAIL_STEPS[i]!.label}…`;

      let response: ReadPageTextResponse;
      try {
        // The Profile step reads the tab as-is when it's already on the
        // base profile page (the usual case — Scan is clicked from there),
        // saving a full page load — see readInPlace for when it falls back
        // to navigating.
        const alreadyOnPage = i === 0 && !tab.url.includes("/details/");
        const inPlace = alreadyOnPage ? await readInPlace(tabId) : undefined;
        if (inPlace) {
          response = inPlace;
        } else {
          await chrome.tabs.update(tabId, { url: baseUrl + DETAIL_STEPS[i]!.suffix });
          await waitForTabComplete(tabId);
          if (cancelled) {
            scanStatusEl.textContent = "Stopped.";
            return;
          }
          // No fixed settle delay: the content script waits until the page
          // has actually rendered and stopped changing (waitForPageReady).
          response = await readPage(tabId);
        }
      } catch (err) {
        steps[i]!.status = "error";
        setStepper(steps);
        showStatus(`Couldn't read ${DETAIL_STEPS[i]!.label}: ${(err as Error).message}`, true);
        return;
      }

      if (i === 0) {
        currentProfile = {
          name: response.meta.name,
          headline: response.meta.headline,
          location: response.meta.location,
          photoUrl: response.meta.photoUrl,
          profileUrl: baseUrl,
          about: response.text,
          experience: "",
          education: "",
          skills: "",
        };
        renderProfileHeader(profileHeaderContainer, currentProfile);
      } else {
        currentProfile = { ...currentProfile!, [DETAIL_STEPS[i]!.key]: response.text };
      }
      renderSections(sectionsContainer, currentProfile, VISIBLE_SECTION_KEYS);

      steps[i]!.status = "done";
      setStepper(steps);
    }


    await chrome.tabs.update(tabId, { url: baseUrl });

    if (AUTO_CLASSIFY) {
      scanStatusEl.textContent = "Classifying…";
      await classifyCurrentProfile();
    } else {
      // Paused: the Classify button still works for a manual run.
      classifyButtonEl.disabled = roleSelectEl.options.length === 0;
    }
  } finally {
    setScanning(false);
    scanStatusEl.hidden = true;
  }
}

scanButtonEl.addEventListener("click", () => void runScan());
stopButtonEl.addEventListener("click", () => {
  cancelled = true;
});
resetButtonEl.addEventListener("click", () => resetPanel());

// Keeps the panel from ever showing one profile's data while the tab sits on
// a different one — the top priority given what broke in the previous
// attempt. Never touches anything mid-scan (that's the scan's own job).
async function checkActiveTabProfile(): Promise<void> {
  if (scanning) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes("linkedin.com/in/")) return;
  const activeBase = baseProfileUrl(tab.url);
  if (currentProfile && currentProfile.profileUrl !== activeBase) {
    resetPanel();
  }
}
chrome.tabs.onActivated.addListener(() => void checkActiveTabProfile());
chrome.tabs.onUpdated.addListener((_tabId, info) => {
  if (info.status === "complete") void checkActiveTabProfile();
});

async function loadRoles(): Promise<void> {
  try {
    const roles = await getRoles();
    roleSelectEl.replaceChildren();
    for (const role of roles) {
      const option = document.createElement("option");
      option.value = role.roleId;
      option.textContent = role.roleId;
      roleSelectEl.appendChild(option);
    }
    roleSelectEl.disabled = roles.length === 0;
    classifyButtonEl.disabled = roles.length === 0 || !currentProfile;
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      showStatus("No API key set — open the settings (⚙) to add one.", true);
    } else {
      showStatus(`Couldn't load roles: ${(err as Error).message}`, true);
    }
  }
}

classifyButtonEl.addEventListener("click", () => void classifyCurrentProfile());

renderProfileHeader(profileHeaderContainer, null);
void loadRoles();
