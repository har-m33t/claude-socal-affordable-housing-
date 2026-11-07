# Pointer data (Team 1)

Read 2026-11-07. Nothing here is `verified: true` or `confirmed: true` until a person on the team
has checked it. The app must show "not yet verified" for anything unverified and give no advice
from it.

| File | What it is |
|---|---|
| `cities/anaheim.json` | Anaheim's six Planning checklist items with page and box, and two fast paths (ADU Express, Pre-Approved Plan Catalogue) |
| `cities/<city>.json` | 33 empty stubs, `verified: false` |
| `cities/_template.json` | Shape for adding a city |
| `types/adu.json` | ADU/JADU statutes and the two 60-day clocks, from the HCD ADU Handbook |
| `types/sb9.json` | Stub, rules not yet verified |
| `statutes.json` | Law Lens old-to-new map, quoted from the Handbook with page links |
| `law-flags.json` | Where Anaheim's checklist disagrees with state law or with another Anaheim page |
| `packet/` | **Made-up** applicant: `manifest.json`, `applicant.json` (values redaction must catch), 3 PDFs |
| `processed/anaheim-adu-checklist-lines.json` | Every text line of the checklist PDF with page and box |

**Boxes** are `[x, y, w, h]` in PDF points at scale 1, origin top-left (pdf.js viewport
coordinates). Multiply by the render scale.

**Fields beyond the plan's contract:** checklist items carry `applies_to` (`adu_and_jadu` or
`jadu`). `statutes.json` wraps its entries in `{"about", "statutes": [...]}`.

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
