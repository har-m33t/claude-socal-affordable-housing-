#!/usr/bin/env python3
"""Dump every text line of a checklist PDF with its page and box.

Usage:
  python -I data/tools/extract_checklist.py data/raw/anaheim-adu-checklist.pdf

Step 1 of building cities/<city>.json: check the PDF has a text layer, then
list candidate lines. A person (or Claude, reviewed by a person) picks which
lines are checklist items; nothing here decides that.

Box convention: [x, y, w, h] in PDF points (1/72 inch) at scale 1, origin at
the TOP-LEFT of the page, matching pdf.js/react-pdf viewport coordinates. Team 2
multiplies by the render scale.

Writes data/processed/<pdf-stem>-lines.json and prints a summary. Exit code 2
if the PDF has no text layer (a scan): measure boxes by hand for demo items.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pymupdf as fitz  # pip install pymupdf

OUT_DIR = Path(__file__).resolve().parent.parent / "processed"


def main(pdf_path: str) -> int:
    src = Path(pdf_path)
    doc = fitz.open(src)
    lines, chars = [], 0
    for pno, page in enumerate(doc, 1):
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                text = "".join(s["text"] for s in line["spans"]).strip()
                if not text:
                    continue
                x0, y0, x1, y1 = line["bbox"]
                chars += len(text)
                lines.append({"page": pno, "text": text,
                              "box": [round(x0, 1), round(y0, 1), round(x1 - x0, 1), round(y1 - y0, 1)]})
    print(f"{src.name}: {doc.page_count} pages, {len(lines)} text lines, {chars} chars")
    if chars < 50:
        print("NO TEXT LAYER: this looks like a scan. Measure boxes by hand for the demo items.")
        return 2
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{src.stem}-lines.json"
    out.write_text(json.dumps({"source_file": src.name, "page_count": doc.page_count,
                               "box_units": "PDF points, top-left origin, [x, y, w, h]",
                               "lines": lines}, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1]))
