// Stateless: answers "what's on this page right now" whenever asked — see
// the plan's "content script is stateless" design decision. No profile
// tracking, no accumulation, nothing that could go stale across navigations.
//
// Types are duplicated locally (not imported from ../lib/*.ts), same
// self-contained-build reasoning as before — see tsconfig.content.json.

function metaContent(property: string): string | undefined {
  const el = document.querySelector(`meta[property="${property}"]`);
  return el?.getAttribute("content")?.trim() || undefined;
}

// The page's own header block (name, connection degree or "Verify in X
// minutes" banner on your own profile, headline, location) sits at the very
// top of document.body.innerText on the base profile page — confirmed live.
// og:description/og:image (the original plan) come back empty on real
// profiles, so headline/location/photo are derived from the visible header
// text/images instead.
//
// Anchored on "Contact info" rather than the connection-degree line: your
// own profile has no "· 1st/2nd/3rd" badge (no connection degree to
// yourself) — anchoring there either missed self-view entirely or, worse,
// fell through to the first such line anywhere on the page, which belonged
// to a stranger's card in the "Suggested for you" rail (confirmed live).
// "Contact info" sits right after location on both self-view and any real
// candidate's profile, so this one anchor covers both without a separate
// self-view branch. Search bounded to the first HEADER_SEARCH_LINES lines
// so it can't match a "Contact info" link belonging to someone else further
// down the page.
//
// Two real layouts confirmed live: location/"·"/"Contact info" as three
// separate lines (Mahesh, Arti), or "<location> · Contact info" combined on
// one line (Anish) — matched as a substring rather than an exact line so
// both work, and the location is pulled out of the same line when combined.
//
// The search window itself needs real margin: document.body.innerText
// starts with LinkedIn's ~15-line site nav/skip-link chrome, then (at least
// on one real profile) a duplicate sticky mini-header (name, headline,
// Message/Connect) *before* the real profile card even starts — confirmed
// live, all of which pushed the real "Contact info" line down to line 26.
// This logic walks backward from "Contact info", so that leading noise is
// otherwise harmless — it just needs to be inside the search window.
const HEADER_SEARCH_LINES = 60;

function extractHeaderMeta(bodyText: string): { headline?: string; location?: string } {
  const lines = bodyText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, HEADER_SEARCH_LINES);
  const contactLineIdx = lines.findIndex((line) => line.includes("Contact info"));
  if (contactLineIdx === -1) return {};

  const sameLineRemainder = lines[contactLineIdx]!.replace("Contact info", "").replace(/·/g, "").trim();
  if (sameLineRemainder) {
    return { headline: lines[contactLineIdx - 1], location: sameLineRemainder };
  }

  let locationIdx = contactLineIdx - 1;
  if (lines[locationIdx] === "·") locationIdx -= 1;
  return { headline: lines[locationIdx - 1], location: lines[locationIdx] };
}

// The top card's photo <img> carries the candidate's name in its alt text
// on a real candidate's profile — matched by name rather than a CSS class
// so it isn't tied to LinkedIn's per-render styling, and only matched
// against the candidate's own name so it can't accidentally pick up a
// different person's photo from the "recommended profiles" rail.
//
// Your own profile's avatar has editing affordances (a pencil overlay) and
// likely doesn't carry your name in alt text the same way, so it falls back
// to shape: the avatar is reliably a roughly-square image sized like an
// avatar (not a tiny company-logo badge, not a full-width banner) near the
// top of the page. Unverified live — worth a visual check after testing.
function findPhotoUrl(name: string | undefined): string | undefined {
  const images = Array.from(document.images);

  if (name) {
    const byAlt = images.find((img) => img.alt && img.alt.includes(name));
    if (byAlt) return byAlt.src;
  }

  const avatar = images.find((img) => {
    const rect = img.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);
    return size >= 60 && size <= 260 && Math.abs(rect.width - rect.height) < 20 && rect.top < 600;
  });
  return avatar?.src;
}

function currentPageMeta(): { name?: string; headline?: string; location?: string; photoUrl?: string } {
  const name = document.title.replace(/\s*\|\s*LinkedIn\s*$/i, "").trim() || metaContent("og:title");
  const { headline, location } = extractHeaderMeta(document.body.innerText ?? "");
  return { name, headline, location, photoUrl: findPhotoUrl(name) };
}

// Confirmed live against a real profile: LinkedIn's plain page text always
// carries a "recommended profiles" rail (other, unrelated candidates' names
// and headlines) plus the full site footer and language picker — and there
// is no narrower DOM landmark to read instead of document.body (<main>
// wraps the whole page, rails and footer included, so switching to it
// wouldn't help). Instead of grabbing everything and hoping, the wanted
// section is cut out using LinkedIn's own stable heading copy as
// boundaries — that copy is far more stable than per-render CSS
// classes/ids, which is what broke the very first version of this
// extension.
//
// "Top skills" is the little chip-list widget LinkedIn shows inside the
// About card itself (before Activity), and "Who your viewers also viewed"/
// "Profile language" are sidebar widgets that showed up leaking into both
// the About and Experience extractions on a richer real profile — all
// confirmed live, cut at like any other rail widget. This list will likely
// need the occasional addition as more profile variants get tested.
const RAIL_MARKERS = [
  "More profiles for you",
  "Explore Premium profiles",
  "People you may know",
  "People also viewed",
  "Who your viewers also viewed",
  "Top skills",
  "Profile language",
];
const FOOTER_MARKERS = ["Select language", "LinkedIn Corporation"];
// LinkedIn's inline "show more" toggle — leftover UI chrome, not content.
const ELLIPSIS_MORE = /^(…|\.\.\.)\s*more$/i;
// Skills-page-only: each skill can be followed by an endorsement/attribution
// line ("<role> at <company>", "N experiences at X and Y other company", or
// "Passed LinkedIn Skill Assessment") — real LinkedIn text, but noise for
// "just the skill names", which is all that's wanted here.
const SKILL_ATTRIBUTION_LINE = /\bat\b/i;
const SKILL_ASSESSMENT_LINE = /^passed .*assessment$/i;
// "3 endorsements" under a skill, and the skills page's category tab labels
// (both confirmed live in real scraped Skills text) — UI chrome, not skills.
const SKILL_ENDORSEMENT_LINE = /^\d+\s+endorsements?$/i;
const SKILL_TAB_LABELS = new Set([
  "All",
  "Industry Knowledge",
  "Tools & Technologies",
  "Interpersonal Skills",
  "Languages",
  "Other Skills",
]);

function sectionBounds(pathname: string): { heading: string; endHeading?: string } {
  if (/\/details\/experience\/?/.test(pathname)) return { heading: "Experience" };
  if (/\/details\/education\/?/.test(pathname)) return { heading: "Education" };
  if (/\/details\/skills\/?/.test(pathname)) return { heading: "Skills" };
  return { heading: "About", endHeading: "Activity" }; // base profile page
}

// Cuts fullText down to just the lines between the first occurrence of
// `heading` and the earliest of: `endHeading` (if given), a rail marker, or
// a footer marker. Returns "" if `heading` isn't found at all (e.g. a
// candidate with no About section) — a thinner section, not a crash.
// LinkedIn's site footer starts with its own "About" link, immediately
// followed by "Accessibility" — confirmed live: read before the real About
// section had rendered, the footer's "About" was the first match and its
// link list came back as the candidate's About text.
const FOOTER_FIRST_LINK_FOLLOWER = "Accessibility";

function findHeadingIndex(lines: string[], heading: string): number {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== heading) continue;
    const next = lines.slice(i + 1).find((line) => line);
    if (next !== FOOTER_FIRST_LINK_FOLLOWER) return i;
  }
  return -1;
}

function extractSection(fullText: string, heading: string, endHeading?: string): string {
  const lines = fullText.split("\n").map((line) => line.trim());
  const startIdx = findHeadingIndex(lines, heading);
  if (startIdx === -1) return "";

  let endIdx = lines.length;
  if (endHeading) {
    const idx = lines.indexOf(endHeading, startIdx + 1);
    if (idx !== -1) endIdx = idx;
  }
  for (let i = startIdx + 1; i < endIdx; i++) {
    const line = lines[i]!;
    if (RAIL_MARKERS.includes(line) || FOOTER_MARKERS.some((marker) => line.includes(marker))) {
      endIdx = i;
      break;
    }
  }

  return lines
    .slice(startIdx + 1, endIdx)
    .filter((line) => line && !ELLIPSIS_MORE.test(line))
    .join("\n")
    .trim();
}

function stripSkillAttributions(text: string): string {
  return text
    .split("\n")
    .filter(
      (line) =>
        line &&
        !SKILL_ATTRIBUTION_LINE.test(line) &&
        !SKILL_ASSESSMENT_LINE.test(line) &&
        !SKILL_ENDORSEMENT_LINE.test(line) &&
        !SKILL_TAB_LABELS.has(line),
    )
    .join("\n");
}

function currentPageText(): string {
  const fullText = document.body.innerText ?? "";
  const { heading, endHeading } = sectionBounds(window.location.pathname);
  const section = extractSection(fullText, heading, endHeading);
  return heading === "Skills" ? stripSkillAttributions(section) : section;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// LinkedIn's app shell (<main id="workspace">, confirmed live) may scroll an
// inner panel rather than the window itself — scrolling only window/body/
// documentElement made no difference at all on a real test, a strong sign
// the real scrollable element is something else. Collected once (not
// per-attempt: querying every element on the page is too expensive to redo
// 20 times) and reused for every scroll attempt below.
function findScrollableContainers(): HTMLElement[] {
  const containers: HTMLElement[] = [];
  for (const el of document.querySelectorAll<HTMLElement>("*")) {
    if (el.scrollHeight <= el.clientHeight + 100) continue;
    const overflowY = getComputedStyle(el).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") containers.push(el);
  }
  return containers;
}

function scrollEverythingToBottom(containers: HTMLElement[]): void {
  window.scrollTo(0, document.body.scrollHeight);
  document.documentElement.scrollTop = document.documentElement.scrollHeight;
  document.body.scrollTop = document.body.scrollHeight;
  for (const el of containers) el.scrollTop = el.scrollHeight;
}

// The skills detail page only renders an initial batch of skills and lazy-
// loads more via infinite scroll — confirmed live (a profile with 51 skills
// only showed ~10 until scrolled). Keeps scrolling to the bottom and stops
// only once no new skill has appeared for quietMs.
//
// Two deliberate differences from the previous fixed-round loop (700 ms
// wait per round, stop after 2 unchanged rounds), both measured live:
//  - It watches the Skills section's own text, not the whole page — the
//    whole page keeps changing from unrelated widgets, which kept the old
//    loop going for nothing (2.8–4.3 s on the same profile).
//  - It checks every pollMs and scrolls again as soon as a batch lands,
//    instead of idling out a full round.
// The stop rule is at least as patient as before: the old loop could stop
// after as little as ~1.4 s of quiet, this one needs a full 2 s — the
// speed-up comes only from not idling, never from giving up sooner.
// Bounded by maxMs so a list that never settles can't hang the scan.
async function loadAllSkills(quietMs = 2000, pollMs = 150, maxMs = 20000): Promise<void> {
  if (!/\/details\/skills\/?/.test(window.location.pathname)) return;

  const containers = findScrollableContainers();
  const skillsText = () => extractSection(document.body.innerText ?? "", "Skills");
  const started = Date.now();
  let last = skillsText();
  let lastGrowth = Date.now();

  while (Date.now() - lastGrowth < quietMs && Date.now() - started < maxMs) {
    scrollEverythingToBottom(containers);
    await delay(pollMs);
    const current = skillsText();
    if (current !== last) {
      last = current;
      lastGrowth = Date.now();
    }
  }
}

// Replaces "wait a fixed 3 s and hope": polls until the page's content has
// actually rendered, then until it stops changing. A fixed wait was
// confirmed unreliable in a background tab (Chrome throttles those, and one
// real run read the Skills page before its list existed — 0 lines — while
// the next run of the same test got all 32).
//
// "Rendered" = the base page's header card is there ("Contact info" — see
// extractHeaderMeta; About can legitimately be missing), or on a detail page
// the section has at least one line of content under its heading.
// "Settled" = two consecutive polls where the part we actually extract (the
// section text, plus headline/location on the base page) is unchanged.
// Deliberately not the whole page: LinkedIn keeps updating unrelated
// widgets (rails, messaging, notification counts), and waiting for the
// whole page to go quiet cost ~3 s on the base page, ~2 s on Skills —
// measured live.
// Bounded by timeoutMs so a page that never renders can't hang the scan —
// it just returns whatever is there (possibly empty) for the caller to
// judge.
// Guards the in-place read (see sidepanel runScan): right after an in-app
// navigation from one profile to another, LinkedIn updates the URL before it
// swaps out the page content, so for a moment the old profile's card and
// sections sit under the new profile's URL. The card's "Contact info" link
// is built from the profile's own /in/<slug>/ address — comparing it to the
// current URL's slug says exactly whose profile is on screen. Profile slugs
// often don't resemble the person's name, so a name check wouldn't work.
// No link found (unexpected layout) = nothing to compare, not a mismatch.
function headerMatchesUrl(): boolean {
  const link = document.querySelector<HTMLAnchorElement>('a[href*="/overlay/contact-info"]');
  if (!link) return true;
  const slug = (path: string) => path.match(/\/in\/([^/]+)/)?.[1]?.toLowerCase();
  return slug(new URL(link.href).pathname) === slug(window.location.pathname);
}

async function waitForPageReady(timeoutMs = 10000, pollMs = 300): Promise<void> {
  const started = Date.now();
  const { heading, endHeading } = sectionBounds(window.location.pathname);
  const isBasePage = heading === "About";

  // Base page: the header card alone isn't enough — LinkedIn draws the
  // header and footer before the profile's own sections (confirmed live,
  // it's how the footer got read as About). "Experience"/"Activity" come
  // after About, so either one being present means About has rendered too.
  const rendered = () => {
    const text = document.body.innerText ?? "";
    if (!isBasePage) return extractSection(text, heading, endHeading) !== "";
    if (!text.includes("Contact info")) return false;
    if (!headerMatchesUrl()) return false;
    const lines = text.split("\n").map((line) => line.trim());
    return lines.includes("Experience") || lines.includes("Activity");
  };

  while (!rendered() && Date.now() - started < timeoutMs) await delay(pollMs);

  const snapshot = () => {
    const text = document.body.innerText ?? "";
    const section = extractSection(text, heading, endHeading);
    if (!isBasePage) return section;
    const { headline, location } = extractHeaderMeta(text);
    return `${headline ?? ""}\n${location ?? ""}\n${section}`;
  };

  let last = snapshot();
  let stableStreak = 0;
  while (stableStreak < 2 && Date.now() - started < timeoutMs) {
    await delay(pollMs);
    const current = snapshot();
    stableStreak = current === last ? stableStreak + 1 : 0;
    last = current;
  }
}

const READ_PAGE_TEXT = "shortlyst:read-page-text";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object" || (message as { type?: unknown }).type !== READ_PAGE_TEXT) {
    return undefined;
  }
  void (async () => {
    await waitForPageReady();
    await loadAllSkills();
    sendResponse({
      text: currentPageText(),
      meta: currentPageMeta(),
      matchesUrl: headerMatchesUrl(),
    });
  })();
  return true; // keep the message channel open for the async response above
});

console.log("[Shortlyst] content script ready on", window.location.href);
