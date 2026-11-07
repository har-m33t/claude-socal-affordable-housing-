# Pointer data (Team 1)

Read 2026-11-07. Anaheim, `types/adu.json`, all of `statutes.json` and all of `law-flags.json` were
reviewed by the Team 1 lead on 2026-11-07. Everything else stays unverified until a person on the team
has checked it. The app must show "not yet verified" for anything unverified and give no advice
from it.

| File | What it is |
|---|---|
| `cities/anaheim.json` | Anaheim's six Planning checklist items with page and box, and two fast paths (ADU Express, Pre-Approved Plan Catalogue) |
| `cities/<city>.json` | 33 empty stubs, `verified: false` |
| `cities/_template.json` | Shape for adding a city |
| `types/adu.json` | ADU/JADU statutes and the two 60-day clocks, from the HCD ADU Handbook. `statutes` is a list of section strings (Team 3's `ProjectTypePack`); `statute_details` holds each one's title, source and confirmation |
| `types/sb9.json` | Stub, rules not yet verified |
| `statutes.json` | Law Lens old-to-new map, quoted from the Handbook with page links. Each entry has a stable `id` (no section numbers in it) that the model names as `statute_id`; once an entry has an `id`, it no longer resolves on `old` |
| `law-flags.json` | Where Anaheim's checklist disagrees with state law or with another Anaheim page |
| `packet/` | **Made-up** applicant: `manifest.json`, `applicant.json` (values redaction must catch), 3 PDFs |
| `docs/anaheim-adu-checklist.pdf` | Unchanged copy of Anaheim's public Nov 2025 checklist, the PDF the boxes refer to. `anaheim.json` points at it with `checklist_pdf`; copy it under the app's `public/` at integration |
| `processed/anaheim-adu-checklist-lines.json` | Every text line of the checklist PDF with page and box |
| `docs/anaheim-adu-express-application.pdf` | Unchanged copy of Anaheim's ADU Express Application, "Revised 10/2/2025" (1 page), from https://www.anaheim.net/DocumentCenter/View/49140/, read 2026-11-07. Also served from `public/data/docs/` |
| `docs/anaheim-b802-impact-fees.pdf` | Unchanged copy of Anaheim's Developer Impact Fees sheet, B802, OCT 2026 (3 pages), from https://www.anaheim.net/DocumentCenter/View/39711/Developer-Impact-Fees---B802, read 2026-11-07. Also served from `public/data/docs/` |
| `processed/anaheim-adu-express-application-lines.json`, `processed/anaheim-b802-impact-fees-lines.json` | Text lines of the two PDFs above, from `tools/extract-pdf-lines.mjs` |
| `plans/anaheim-adu.json` | The multi-step plan (`contracts/plan.schema.json`): 4 documents, 38 targets, 13 steps. Target texts are verbatim from the lines files; form-field boxes are the form's table cells (label plus blank), measured from the PDF's drawn rules. The server merges its PDF targets into the city checklist (`lib/plan/load.ts`) so they are valid agent item_ids. `fixtures/plan-run.json` is the scripted run over it |

**Boxes** are `[x, y, w, h]` in PDF points at scale 1, origin top-left (pdf.js viewport
coordinates). Multiply by the render scale.

**`tools/extract-pdf-lines.mjs`** (Node, pdf.js; no Python deps) writes the same lines format with the
same box convention: `node data/tools/extract-pdf-lines.mjs <in.pdf> <out-lines.json>`. Checked against
Z412: x matches PyMuPDF exactly, y is top-left; pdf.js boxes are the font's em box, so they sit about
3 pt lower and 3-4 pt shorter than PyMuPDF's (e.g. "Overview" `[36.0, 121.3, 50.4, 16.7]` vs
`[36, 124.8, 47.8, 12]`). Plan boxes are drawn with a little padding, so this does not matter for pointing.

**Fields beyond the plan's contract:** cities carry `checklist_pdf` (proposed by Team 2); checklist
items carry `applies_to` (`adu_and_jadu` or `jadu`). `statutes.json` wraps its entries in `{"about", "statutes": [...]}`.

**Rebuild** (sources are in `data/raw/`, which git ignores; download URLs are in each file):

```bash
python -I data/tools/extract_checklist.py data/raw/anaheim-adu-checklist.pdf
python -I data/tools/build_anaheim.py
python -I data/tools/make_stubs.py claude-impact-lab-uci-main/lanes/2-clear-it/data/oc-cities.json
python -I data/tools/make_packet.py
python -I data/tools/validate.py
```

Needs `pip install pymupdf jsonschema`.

**Corrections to the organizers' data list:** the 60-day deadline is Gov Code 66317(a)(3) per the
Handbook (p. 11), not 66314. The Handbook maps 65852.2, .22, .23 and .26 to the whole range
66310-66342, not 65852.22 to 66333 alone.
