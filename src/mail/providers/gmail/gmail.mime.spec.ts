import type { GmailMessage, GmailThread } from "./gmail.api";
import { parseAddress, toMailMessage, toMailThread } from "./gmail.mime";

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");

function message(overrides: Partial<GmailMessage> & { payload: GmailMessage["payload"] }): GmailMessage {
  return { id: "m1", threadId: "t1", internalDate: "1759200000000", ...overrides };
}

describe("parseAddress", () => {
  it("parses name and address, lower-casing the address", () => {
    expect(parseAddress('"Arti Parihar" <Arti@Gmail.com>')).toEqual({ email: "arti@gmail.com", name: "Arti Parihar" });
    expect(parseAddress("Arti Parihar <arti@gmail.com>")).toEqual({ email: "arti@gmail.com", name: "Arti Parihar" });
    expect(parseAddress("arti@gmail.com")).toEqual({ email: "arti@gmail.com" });
    expect(parseAddress(undefined)).toEqual({ email: "" });
  });
});

describe("toMailMessage", () => {
  it("reads headers and a single-part plain body", () => {
    const result = toMailMessage(
      message({
        payload: {
          mimeType: "text/plain",
          headers: [
            { name: "From", value: "Arti <arti@gmail.com>" },
            { name: "To", value: "hr@tequity.tech, Jobs <jobs@tequity.tech>" },
            { name: "Subject", value: "Application – Full Stack Developer" },
            { name: "List-Unsubscribe", value: "<mailto:x@y>" },
          ],
          body: { size: 5, data: b64("Hello, please find my CV.") },
        },
      }),
    );
    expect(result.from).toEqual({ email: "arti@gmail.com", name: "Arti" });
    expect(result.to).toEqual(["hr@tequity.tech", "jobs@tequity.tech"]);
    expect(result.subject).toBe("Application – Full Stack Developer");
    expect(result.headers["list-unsubscribe"]).toBe("<mailto:x@y>");
    expect(result.bodyText).toBe("Hello, please find my CV.");
    expect(result.receivedAt.getTime()).toBe(1759200000000);
    expect(result.attachments).toEqual([]);
  });

  it("walks nested multipart parts: alternative bodies plus an attachment", () => {
    const result = toMailMessage(
      message({
        payload: {
          mimeType: "multipart/mixed",
          headers: [{ name: "From", value: "arti@gmail.com" }],
          parts: [
            {
              mimeType: "multipart/alternative",
              parts: [
                { mimeType: "text/plain", body: { size: 3, data: b64("Plain body") } },
                { mimeType: "text/html", body: { size: 3, data: b64("<p>HTML body</p>") } },
              ],
            },
            { mimeType: "application/pdf", filename: "Arti_CV.pdf", body: { size: 184233, attachmentId: "ANGj" } },
          ],
        },
      }),
    );
    expect(result.bodyText).toBe("Plain body");
    expect(result.bodyHtml).toBe("<p>HTML body</p>");
    expect(result.attachments).toEqual([{ id: "ANGj", filename: "Arti_CV.pdf", mimeType: "application/pdf", size: 184233 }]);
  });

  it("keeps an HTML-only body as bodyHtml", () => {
    const result = toMailMessage(
      message({ payload: { mimeType: "text/html", headers: [], body: { size: 1, data: b64("<b>Hi</b>") } } }),
    );
    expect(result.bodyText).toBeUndefined();
    expect(result.bodyHtml).toBe("<b>Hi</b>");
  });
});

describe("toMailThread", () => {
  it("orders messages oldest first", () => {
    const thread: GmailThread = {
      id: "t1",
      messages: [
        message({ id: "later", internalDate: "2000", payload: { mimeType: "text/plain", headers: [] } }),
        message({ id: "earlier", internalDate: "1000", payload: { mimeType: "text/plain", headers: [] } }),
      ],
    };
    expect(toMailThread(thread).messages.map((m) => m.id)).toEqual(["earlier", "later"]);
  });
});
