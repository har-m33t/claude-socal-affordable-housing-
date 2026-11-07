import { describe, expect, it } from "vitest";
import { MAX_FILENAME_LENGTH, MAX_UPLOAD_BYTES, sanitizeFilename, validateUpload } from "@/lib/redact";

const bytes = (...parts: (string | number[])[]): Uint8Array => {
  const chunks = parts.map((p) => (typeof p === "string" ? new TextEncoder().encode(p) : Uint8Array.from(p)));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let i = 0;
  for (const c of chunks) {
    out.set(c, i);
    i += c.length;
  }
  return out;
};

// Minimal but real files.
const PDF = bytes(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n",
  "trailer<</Root 1 0 R>>\n%%EOF\n",
);
const PNG = bytes(
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  [0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89],
  [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82],
);
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], "JFIF", [0x00, 0x01, 0x01, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);

// Things that must never get through, whatever they are called.
const IMPOSTORS: Record<string, Uint8Array> = {
  "docx (zip)": bytes([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00], "[Content_Types].xml"),
  html: bytes("<!DOCTYPE html><html><script>alert(1)</script></html>"),
  "windows exe": bytes([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00], "This program cannot be run in DOS mode"),
  "elf binary": bytes([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]),
  svg: bytes('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'),
  "pdf header not at start": bytes("   %PDF-1.4\n%%EOF"),
  "plain text": bytes("hello"),
};

const file = (data: Uint8Array, name: string, type = "") => new File([data as BlobPart], name, { type });

describe("validateUpload", () => {
  it.each([
    ["pdf", PDF, "plan.pdf", "application/pdf", "plan.pdf"],
    ["png", PNG, "site.png", "image/png", "site.png"],
    ["jpeg", JPEG, "photo.jpg", "image/jpeg", "photo.jpg"],
    ["jpeg", JPEG, "photo.JPEG", "", "photo.jpeg"],
    ["pdf", PDF, "SCAN.PDF", "", "SCAN.pdf"],
  ] as const)("accepts a real %s (%s)", async (kind, data, name, type, safeName) => {
    const res = await validateUpload(file(data, name, type));
    expect(res).toEqual({ ok: true, kind, size: data.length, safeName });
  });

  for (const [label, data] of Object.entries(IMPOSTORS)) {
    it(`rejects ${label} even when named .pdf with a PDF MIME type`, async () => {
      for (const f of [
        file(data, "checklist.pdf", "application/pdf"),
        file(data, "checklist.pdf"),
        file(data, "checklist", "application/pdf"),
        file(data, "photo.png", "image/png"),
      ]) {
        const res = await validateUpload(f);
        expect(res.ok, `${label} as ${f.name}`).toBe(false);
        if (!res.ok) expect(res.reason).toMatch(/Only PDF, PNG and JPEG/);
      }
    });
  }

  it("rejects real files whose name or MIME type disagrees with their contents", async () => {
    const cases = [
      file(PNG, "plan.pdf", "application/pdf"),
      file(PDF, "image.png"),
      file(PDF, "letter.docx"),
      file(PDF, "page.html"),
      file(PDF, "plan.pdf", "text/html"),
      file(JPEG, "photo.jpg", "image/png"),
    ];
    for (const f of cases) {
      const res = await validateUpload(f);
      expect(res.ok, `${f.name} ${f.type}`).toBe(false);
      if (!res.ok) expect(res.reason).toMatch(/file name ends in|browser says/);
    }
  });

  it("rejects empty files", async () => {
    const res = await validateUpload(file(new Uint8Array(0), "empty.pdf", "application/pdf"));
    expect(res).toEqual({ ok: false, reason: expect.stringMatching(/empty/) });
  });

  it("enforces the 10 MB cap exactly", async () => {
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set(PDF);
    const tooBig = await validateUpload(file(big, "big.pdf", "application/pdf"));
    expect(tooBig).toEqual({ ok: false, reason: expect.stringMatching(/over the 10\.0 MB limit/) });

    const atLimit = await validateUpload(file(big.subarray(0, MAX_UPLOAD_BYTES), "limit.pdf"));
    expect(atLimit.ok).toBe(true);
  });

  it("accepts a nameless Blob by its bytes and gives it a safe name", async () => {
    const res = await validateUpload(new Blob([PNG as BlobPart], { type: "image/png" }));
    expect(res).toEqual({ ok: true, kind: "png", size: PNG.length, safeName: "upload.png" });
  });

  it("sanitizes hostile file names", async () => {
    const res = await validateUpload(file(PDF, "../../etc/passwd\u0000.pdf", "application/pdf"));
    expect(res.ok && res.safeName).toBe("passwd.pdf");
  });
});

describe("sanitizeFilename", () => {
  it.each([
    ["../../etc/passwd.pdf", "pdf", "passwd.pdf"],
    ["..\\..\\Windows\\system32\\evil.pdf", "pdf", "evil.pdf"],
    ["C:\\Users\\me\\Desktop\\Site Plan (final).pdf", "pdf", "Site_Plan_final.pdf"],
    ["....pdf", "pdf", "upload.pdf"],
    ["..", "pdf", "upload.pdf"],
    ["", "png", "upload.png"],
    [".hidden.png", "png", "hidden.png"],
    ["a\u0000b\u001fc\u007f.png", "png", "abc.png"],
    ["plan..v2...final.pdf", "pdf", "plan.v2.final.pdf"],
    ["<script>alert(1)</script>.pdf", "pdf", "script.pdf"],
    ["plano de sitio – José.pdf", "pdf", "plano_de_sitio_Jose.pdf"],
    ["photo.jpeg", "jpeg", "photo.jpeg"],
    ["photo.JPG", "jpeg", "photo.jpg"],
    ["photo", "jpeg", "photo.jpg"],
    ["report.pdf.exe", "pdf", "report.pdf.exe.pdf"],
    ["CON.pdf", "pdf", "file_CON.pdf"],
    ["   spaces   .png", "png", "spaces.png"],
  ] as const)("%j -> %s", (input, kind, expected) => {
    expect(sanitizeFilename(input, kind)).toBe(expected);
  });

  it("caps the length and keeps the extension", () => {
    const out = sanitizeFilename(`${"a".repeat(500)}.pdf`, "pdf");
    expect(out.length).toBeLessThanOrEqual(MAX_FILENAME_LENGTH);
    expect(out.endsWith(".pdf")).toBe(true);
  });

  it("only ever returns safe characters", () => {
    const nasty = "../\u202Egpj.exe\u0000|*?:\"<>名前 ~$%&;`.pdf";
    expect(sanitizeFilename(nasty, "pdf")).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/);
  });
});
