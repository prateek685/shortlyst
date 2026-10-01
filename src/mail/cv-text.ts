import mammoth from "mammoth";
import { extractText } from "unpdf";
import type { MailAttachmentRef } from "./provider";

// Attached CV → plain text, in memory only (files are never stored).

export const MAX_CV_BYTES = 10 * 1024 * 1024;
// Below this many non-whitespace characters a PDF is treated as having no
// real text layer — typically a scanned or photographed CV (needs OCR).
const MIN_TEXT_CHARS = 50;

export type CvKind = "pdf" | "docx" | "doc";

export type CvTextResult = { ok: true; text: string } | { ok: false; reason: string };

/** Which attachments look like a CV at all. */
export function cvKind(attachment: MailAttachmentRef): CvKind | null {
  const name = attachment.filename.toLowerCase();
  const mime = attachment.mimeType.toLowerCase();
  if (name.endsWith(".pdf") || mime === "application/pdf") return "pdf";
  if (name.endsWith(".docx") || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return "docx";
  }
  if (name.endsWith(".doc") || mime === "application/msword") return "doc";
  return null;
}

export async function extractCvText(buffer: Buffer, kind: CvKind): Promise<CvTextResult> {
  if (buffer.length > MAX_CV_BYTES) return { ok: false, reason: "larger than 10 MB" };
  try {
    if (kind === "pdf") {
      const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
      const merged = Array.isArray(text) ? text.join("\n") : text;
      if (merged.replace(/\s/g, "").length < MIN_TEXT_CHARS) {
        return { ok: false, reason: "no readable text (scanned image?)" };
      }
      return { ok: true, text: merged.trim() };
    }
    if (kind === "docx") {
      const { value } = await mammoth.extractRawText({ buffer });
      if (value.replace(/\s/g, "").length < MIN_TEXT_CHARS) return { ok: false, reason: "no readable text" };
      return { ok: true, text: value.trim() };
    }
    return { ok: false, reason: "old .doc format isn't supported" };
  } catch (err) {
    return { ok: false, reason: `couldn't be read (${(err as Error).message.slice(0, 120)})` };
  }
}
