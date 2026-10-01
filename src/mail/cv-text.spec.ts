import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cvKind, extractCvText, MAX_CV_BYTES } from "./cv-text";

const fixture = (name: string) => readFileSync(join(__dirname, "__fixtures__", name));

describe("cvKind", () => {
  it("recognises CV-like attachments by extension or MIME type", () => {
    expect(cvKind({ id: "1", filename: "Arti_CV.PDF", mimeType: "application/octet-stream", size: 1 })).toBe("pdf");
    expect(cvKind({ id: "1", filename: "resume", mimeType: "application/pdf", size: 1 })).toBe("pdf");
    expect(
      cvKind({
        id: "1",
        filename: "cv.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: 1,
      }),
    ).toBe("docx");
    expect(cvKind({ id: "1", filename: "old.doc", mimeType: "application/msword", size: 1 })).toBe("doc");
    expect(cvKind({ id: "1", filename: "photo.jpg", mimeType: "image/jpeg", size: 1 })).toBeNull();
  });
});

describe("extractCvText", () => {
  it("reads text from a PDF", async () => {
    const result = await extractCvText(fixture("cv-text.pdf"), "pdf");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toContain("React.js");
  });

  it("reports a PDF with no text layer as unreadable (scanned)", async () => {
    const result = await extractCvText(fixture("cv-scanned.pdf"), "pdf");
    expect(result).toEqual({ ok: false, reason: "no readable text (scanned image?)" });
  });

  it("reads text from a DOCX", async () => {
    const result = await extractCvText(fixture("cv.docx"), "docx");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toContain("Playwright");
  });

  it("does not attempt old .doc files", async () => {
    expect(await extractCvText(Buffer.from("x"), "doc")).toEqual({ ok: false, reason: "old .doc format isn't supported" });
  });

  it("rejects files over the size limit", async () => {
    expect(await extractCvText(Buffer.alloc(MAX_CV_BYTES + 1), "pdf")).toEqual({ ok: false, reason: "larger than 10 MB" });
  });
});
