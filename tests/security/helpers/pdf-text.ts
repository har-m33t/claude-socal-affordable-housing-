/**
 * Extracts a PDF's text layer with pdfjs-dist (legacy build, for Node), the same
 * library the app uses, so the PDF -> text path in the injection test is real.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const PDFJS_ROOT = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
const STANDARD_FONTS = join(PDFJS_ROOT, "standard_fonts") + "/";

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  // pdfjs may transfer (detach) the buffer it is given, so hand it a copy.
  const task = getDocument({
    data: bytes.slice(),
    useSystemFonts: false,
    standardFontDataUrl: STANDARD_FONTS,
  });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if ("str" in item) text += item.str + (item.hasEOL ? "\n" : " ");
      }
      pages.push(text.trim());
    }
    return pages.join("\n\n");
  } finally {
    await task.destroy();
  }
}
