#!/usr/bin/env node
// Dump every text line of a PDF with its page and box, using pdf.js (no Python deps).
//
// Usage:
//   node data/tools/extract-pdf-lines.mjs <input.pdf> <output-lines.json>
//
// Same output shape and box convention as extract_checklist.py (PyMuPDF):
// {source_file, page_count, box_units, lines: [{page, text, box}]}, where box is
// [x, y, w, h] in PDF points at scale 1, origin at the TOP-LEFT of the page
// (pdf.js viewport coordinates). The UI multiplies by the render scale.
//
// A "line" is a run of text items on the same baseline, split where the
// horizontal gap between items is wider than ~3 spaces (so form labels in
// separate columns come out as separate lines). The box's top is the font's
// ascent above the baseline and its height runs to the font's descent, which is
// how PyMuPDF measures line boxes; re-extracting the Z412 checklist reproduces
// Team 1's boxes to within a few tenths of a point (see data/README.md).
//
// Exit code 2 if the PDF has no text layer (a scan).
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const r1 = (n) => Math.round(n * 10) / 10;

async function main(input, output) {
  const data = new Uint8Array(await readFile(input));
  const doc = await getDocument({ data, isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise;
  const lines = [];
  let chars = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    // Turn each text item into a top-left box. Items are horizontal in these
    // city forms; rotated text would need the full transform.
    const items = [];
    for (const it of content.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      const style = content.styles[it.fontName] ?? {};
      const size = Math.hypot(it.transform[2], it.transform[3]) || it.height;
      const ascent = style.ascent ?? 0.8;
      const descent = style.descent ?? -0.2;
      const [vx, vy] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
      items.push({
        str: it.str,
        x0: vx,
        x1: vx + it.width,
        base: vy,
        top: vy - ascent * size,
        bottom: vy - descent * size,
        size,
      });
    }
    // Group by baseline (within 2 pt), then left to right, splitting wide gaps.
    items.sort((a, b) => a.base - b.base || a.x0 - b.x0);
    const rows = [];
    for (const it of items) {
      const row = rows.find((r) => Math.abs(r.base - it.base) <= 2);
      if (row) row.items.push(it);
      else rows.push({ base: it.base, items: [it] });
    }
    for (const row of rows) {
      row.items.sort((a, b) => a.x0 - b.x0);
      let run = [];
      const flush = () => {
        if (!run.length) return;
        let text = "";
        let prev = null;
        for (const it of run) {
          if (prev && it.x0 - prev.x1 > prev.size * 0.15 && !text.endsWith(" ") && !it.str.startsWith(" ")) text += " ";
          text += it.str;
          prev = it;
        }
        text = text.replace(/\s+$/, "").replace(/^\s+/, "");
        if (text) {
          const x0 = Math.min(...run.map((i) => i.x0));
          const x1 = Math.max(...run.map((i) => i.x1));
          const y0 = Math.min(...run.map((i) => i.top));
          const y1 = Math.max(...run.map((i) => i.bottom));
          chars += text.length;
          lines.push({ page: p, text, box: [r1(x0), r1(y0), r1(x1 - x0), r1(y1 - y0)] });
        }
        run = [];
      };
      for (const it of row.items) {
        const last = run[run.length - 1];
        if (last && it.x0 - last.x1 > Math.max(last.size, it.size) * 1.5) flush();
        run.push(it);
      }
      flush();
    }
  }
  console.log(`${basename(input)}: ${doc.numPages} pages, ${lines.length} text lines, ${chars} chars`);
  if (chars < 50) {
    console.log("NO TEXT LAYER: this looks like a scan. Measure boxes by hand.");
    return 2;
  }
  const out = {
    source_file: basename(input),
    page_count: doc.numPages,
    box_units: "PDF points, top-left origin, [x, y, w, h]",
    lines,
  };
  await writeFile(output, JSON.stringify(out, null, 1) + "\n", "utf8");
  console.log(`wrote ${output}`);
  return 0;
}

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: node data/tools/extract-pdf-lines.mjs <input.pdf> <output-lines.json>");
  process.exit(1);
}
process.exit(await main(input, output));
