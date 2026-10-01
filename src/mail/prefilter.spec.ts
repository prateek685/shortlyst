import { skipReason } from "./prefilter";
import type { MailMessage } from "./provider";

const MAILBOX = "hr@tequity.tech";

function msg(overrides: Partial<MailMessage> = {}): MailMessage {
  return {
    id: "m1",
    from: { email: "arti@gmail.com", name: "Arti" },
    to: [MAILBOX],
    subject: "Application for Full Stack Developer",
    receivedAt: new Date(),
    headers: {},
    attachments: [],
    ...overrides,
  };
}

describe("skipReason", () => {
  it("keeps a normal candidate email", () => {
    expect(skipReason(msg(), MAILBOX)).toBeNull();
  });

  it("skips mail sent by the connected mailbox itself", () => {
    expect(skipReason(msg({ from: { email: "hr@tequity.tech" } }), "HR@tequity.tech")).toBe("sent by the connected mailbox");
  });

  it("skips no-reply and mailer-daemon senders", () => {
    expect(skipReason(msg({ from: { email: "no-reply@portal.com" } }), MAILBOX)).toMatch(/automated sender/);
    expect(skipReason(msg({ from: { email: "noreply@portal.com" } }), MAILBOX)).toMatch(/automated sender/);
    expect(skipReason(msg({ from: { email: "mailer-daemon@googlemail.com" } }), MAILBOX)).toMatch(/automated sender/);
    // a real person whose address merely contains "reply" is kept
    expect(skipReason(msg({ from: { email: "replyton@gmail.com" } }), MAILBOX)).toBeNull();
  });

  it("skips auto-replies by header or subject", () => {
    expect(skipReason(msg({ headers: { "auto-submitted": "auto-replied" } }), MAILBOX)).toBe("auto-reply");
    expect(skipReason(msg({ headers: { "auto-submitted": "no" } }), MAILBOX)).toBeNull();
    expect(skipReason(msg({ subject: "Out of Office: back Monday" }), MAILBOX)).toBe("auto-reply");
    expect(skipReason(msg({ subject: "Automatic reply: Application" }), MAILBOX)).toBe("auto-reply");
  });

  it("skips newsletters and bulk mail", () => {
    expect(skipReason(msg({ headers: { "list-unsubscribe": "<mailto:u@x.com>" } }), MAILBOX)).toMatch(/bulk mail/);
    expect(skipReason(msg({ headers: { precedence: "bulk" } }), MAILBOX)).toBe("bulk mail");
  });
});
