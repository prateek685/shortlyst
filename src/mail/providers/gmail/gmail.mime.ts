import type { MailAddress, MailAttachmentRef, MailMessage, MailThread } from "../../provider";
import type { GmailMessage, GmailPart, GmailThread } from "./gmail.api";

// Pure conversion from Gmail's `format=full` payload (a tree of MIME parts,
// bodies base64url-encoded) to the provider-neutral MailThread.

function decode(data: string | undefined): string | undefined {
  return data ? Buffer.from(data, "base64url").toString("utf8") : undefined;
}

/** `"Arti Parihar" <arti@gmail.com>` / `arti@gmail.com` → address + name. */
export function parseAddress(raw: string | undefined): MailAddress {
  if (!raw) return { email: "" };
  const angle = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (angle) {
    const name = angle[1]!.trim();
    return { email: angle[2]!.trim().toLowerCase(), ...(name ? { name } : {}) };
  }
  return { email: raw.trim().toLowerCase() };
}

function splitAddressList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => parseAddress(part).email)
    .filter(Boolean);
}

interface Collected {
  text: string[];
  html: string[];
  attachments: MailAttachmentRef[];
}

function walk(part: GmailPart, out: Collected): void {
  const isAttachment = Boolean(part.filename) && Boolean(part.body?.attachmentId);
  if (isAttachment) {
    out.attachments.push({
      id: part.body!.attachmentId!,
      filename: part.filename!,
      mimeType: part.mimeType,
      size: part.body?.size ?? 0,
    });
    return;
  }
  if (part.mimeType === "text/plain" && !part.filename) {
    const text = decode(part.body?.data);
    if (text) out.text.push(text);
  } else if (part.mimeType === "text/html" && !part.filename) {
    const html = decode(part.body?.data);
    if (html) out.html.push(html);
  }
  for (const child of part.parts ?? []) walk(child, out);
}

export function toMailMessage(message: GmailMessage): MailMessage {
  const headers: Record<string, string> = {};
  for (const header of message.payload.headers ?? []) {
    headers[header.name.toLowerCase()] = header.value;
  }

  const collected: Collected = { text: [], html: [], attachments: [] };
  walk(message.payload, collected);

  return {
    id: message.id,
    from: parseAddress(headers.from),
    to: splitAddressList(headers.to),
    subject: headers.subject ?? "",
    receivedAt: new Date(Number(message.internalDate)),
    headers,
    ...(collected.text.length ? { bodyText: collected.text.join("\n") } : {}),
    ...(collected.html.length ? { bodyHtml: collected.html.join("\n") } : {}),
    attachments: collected.attachments,
  };
}

export function toMailThread(thread: GmailThread): MailThread {
  return {
    id: thread.id,
    messages: (thread.messages ?? [])
      .map(toMailMessage)
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime()),
  };
}
