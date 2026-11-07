// One place that configures pdf.js for the stage: the worker, and the options
// every document is opened with. Browser only (import from client components
// loaded with ssr: false).
//
// Security: pdf.js scripting is never enabled (it is a viewer-level feature we do
// not use), XFA forms are off, and annotation/text layers are not rendered. pdf.js
// v5 (react-pdf 11) removed eval-based font compilation entirely, so the old
// `isEvalSupported: false` switch no longer exists; there is nothing to turn off.
import { pdfjs } from "react-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

/** Options for react-pdf <Document>. Kept as one constant so react-pdf never reloads the file. */
export const PDF_OPTIONS = { enableXfa: false } as const;

/** Caps on what we read from a homeowner's PDF for the redaction preview. */
export const MAX_TEXT_PAGES = 40;
export const MAX_TEXT_CHARS = 200_000;

/**
 * Plain text of a PDF the homeowner chose, read entirely in the browser. Lines are
 * rebuilt from pdf.js `hasEOL` markers; pages are separated by a blank line.
 */
export async function extractPdfText(data: ArrayBuffer): Promise<{ text: string; pages: number; truncated: boolean }> {
  const task = pdfjs.getDocument({ data: new Uint8Array(data), enableXfa: false, stopAtErrors: false });
  const pdf = await task.promise;
  try {
    const pages = Math.min(pdf.numPages, MAX_TEXT_PAGES);
    let text = "";
    for (let p = 1; p <= pages && text.length < MAX_TEXT_CHARS; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if ("str" in item) text += item.str + (item.hasEOL ? "\n" : "");
      }
      text += "\n\n";
      page.cleanup();
    }
    const truncated = pdf.numPages > pages || text.length > MAX_TEXT_CHARS;
    return { text: text.slice(0, MAX_TEXT_CHARS).trim(), pages: pdf.numPages, truncated };
  } finally {
    await task.destroy();
  }
}
