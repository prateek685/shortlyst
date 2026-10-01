import type { MailMessage } from "./provider";

// Cheap, Jev-free filter on the normalized headers: anything caught here is
// never sent to Jev. Returns why a message should be skipped, or null to keep
// it.

const AUTOMATED_SENDER = /^(mailer-daemon|postmaster)@|(^|[._+-])no-?reply([._+-]|@)/i;
const AUTO_REPLY_SUBJECT = /^\s*(out of (the )?office|automatic reply|auto[- ]?reply|autoreply)\b/i;

export function skipReason(message: MailMessage, mailbox: string): string | null {
  const from = message.from.email;
  if (!from) return "no sender address";
  if (from === mailbox.toLowerCase()) return "sent by the connected mailbox";
  if (AUTOMATED_SENDER.test(from)) return "automated sender (no-reply / mailer-daemon)";

  const headers = message.headers;
  const autoSubmitted = headers["auto-submitted"]?.trim().toLowerCase();
  if ((autoSubmitted && autoSubmitted !== "no") || headers["x-autoreply"] || headers["x-autorespond"]) {
    return "auto-reply";
  }
  if (AUTO_REPLY_SUBJECT.test(message.subject)) return "auto-reply";

  if (headers["list-unsubscribe"] || headers["list-id"]) return "bulk mail (mailing list)";
  if (/^(bulk|list|junk)$/i.test(headers["precedence"]?.trim() ?? "")) return "bulk mail";

  return null;
}
