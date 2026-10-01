import { convert } from "html-to-text";
import type { MailMessage } from "./provider";

// The text Jev reads for an email thread — the email equivalent of the
// LinkedIn profile text. Capped so a long thread or a 20-page CV can't blow
// up the cost of the calls.

export const BODY_CAP = 4_000;
export const CV_CAP = 12_000;

export interface ReadCv {
  filename: string;
  text: string;
}

export function messageBody(message: MailMessage): string {
  const raw =
    message.bodyText ??
    (message.bodyHtml
      ? convert(message.bodyHtml, {
          wordwrap: false,
          selectors: [
            { selector: "a", options: { ignoreHref: true } },
            { selector: "img", format: "skip" },
          ],
        })
      : "");
  return stripQuotedReply(raw).trim();
}

// A reply usually repeats the whole earlier conversation below an
// "On … wrote:" line or as ">"-prefixed lines — already in the thread, so
// dropped rather than paid for twice.
export function stripQuotedReply(text: string): string {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    if (/^On .+wrote:\s*$/.test(line.trim())) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line.trim())) break;
    if (line.trimStart().startsWith(">")) continue;
    kept.push(line);
  }
  return kept.join("\n");
}

function cap(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n[…truncated]` : text;
}

export function buildThreadText(messages: MailMessage[], cvs: ReadCv[]): string {
  const first = messages[0];
  const header = first
    ? [`From: ${first.from.name ? `${first.from.name} <${first.from.email}>` : first.from.email}`, `Subject: ${first.subject}`]
    : [];

  const bodies = messages.map(messageBody).filter(Boolean).join("\n---\n");
  const sections = [...header, "", "Email:", cap(bodies, BODY_CAP)];

  let cvBudget = CV_CAP;
  for (const cv of cvs) {
    if (cvBudget <= 0) break;
    const text = cap(cv.text, cvBudget);
    cvBudget -= cv.text.length;
    sections.push("", `CV (${cv.filename}):`, text);
  }

  return sections.join("\n").trim();
}
