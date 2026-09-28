// The side panel asks the content script to read whatever page is currently
// loaded — the content script is stateless, it just answers with what's
// there right now. No push messages, no persisted state (see the plan's
// "no chrome.storage involvement in scanning" decision).
export const READ_PAGE_TEXT = "shortlyst:read-page-text" as const;

export interface ReadPageTextMessage {
  type: typeof READ_PAGE_TEXT;
}

export interface PageMeta {
  name?: string;
  headline?: string;
  location?: string;
  photoUrl?: string;
}

export interface ReadPageTextResponse {
  text: string;
  meta: PageMeta;
  /** false = the page on screen still belongs to a different profile than the URL (mid-navigation) */
  matchesUrl?: boolean;
}
