#!/usr/bin/env python3
"""Build data/cities/anaheim.json from the extracted checklist lines.

Usage:
  python -I data/tools/extract_checklist.py data/raw/anaheim-adu-checklist.pdf
  python -I data/tools/build_anaheim.py

ITEMS below is the human-reviewed choice of which extracted lines form each
checklist item (indices into data/processed/anaheim-adu-checklist-lines.json).
Each item's box is the union of its lines' boxes, in PDF points with a top-left
origin. Item text is the printed text, joined, with the checkbox glyph removed.

FAST_PATHS rules are quoted or closely paraphrased from the saved city pages
(data/raw/anaheim-adu-page.html, data/raw/anaheim-pre-approved-plans.html).
Anything those pages do not state is written as unknown.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent
LINES = DATA / "processed" / "anaheim-adu-checklist-lines.json"
OUT = DATA / "cities" / "anaheim.json"
CHECKED = "2026-11-07"

CHECKLIST_URL = ("https://www.anaheim.net/DocumentCenter/View/35053/"
                 "Accessory-Dwelling-Unit-Submittal-Requirements-Checklist")
ADU_PAGE = "https://www.anaheim.net/6349/ADU-Anaheim"
PLANS_PAGE = "https://www.anaheim.net/6351/Pre-Approved-Plan-Catalogue"

# (id, first line, last line, label the first line must contain, last line must end with,
#  doc_type, applies_to). The label checks stop a re-extraction that orders lines
# differently from silently giving an item the wrong text and box.
ITEMS = [
    ("sewer-capacity-verification", 16, 19, "SEWER DEFICIENCY VERIFICATION", "email inquiry.",
     "sewer_capacity_verification", "adu_and_jadu"),
    ("meter-spot-report", 20, 23, "METER SPOT REPORT", "plan check submittal.",
     "meter_spot_report", "adu_and_jadu"),
    ("new-address-request", 24, 27, "NEW ADDRESS REQUEST", "same day processing.",
     "new_address_request", "adu_and_jadu"),
    ("jadu-owner-occupancy-covenant", 29, 43, "OWNER OCCUPANCY COVENANT", "Clerk\u2019s office:",
     "owner_occupancy_covenant", "jadu"),
    ("jadu-title-report", 44, 44, "TITLE REPORT", "submittal date)", "title_report", "jadu"),
    ("jadu-grant-deed", 45, 45, "GRANT DEED", "GRANT DEED", "grant_deed", "jadu"),
]

FAST_PATHS = [
    {
        "id": "adu-express",
        "name": "ADU Express",
        "rules": [
            "Only available for certain qualified single-family properties.",
            "The homeowner selects one of the pre-approved detached ADUs in the ADU Pre-Approved Plan Catalogue, then enters an accelerated review.",
            "Eligibility is checked with the city's ADU Express Eligibility Tool by address. The eligibility criteria themselves are not published on this page: unknown.",
            "Review time: the ADU Anaheim page says 'within 1-3 days'; the Nov 2025 checklist says 'one day permitting'. The sources disagree; confirm with the city.",
            "Before the accelerated review, the Pre-Approved Plan Catalogue page says to email the city your address, selected plan number and a copy of your meter spot report; staff screening to verify eligibility 'can take a few weeks'.",
        ],
        "source": ADU_PAGE,
    },
    {
        "id": "pre-approved-plans",
        "name": "ADU Pre-Approved Plan Catalogue",
        "rules": [
            "Four city-approved plans, all listed as free: Plan 001 studio 224 sf; Plan 002 1 bed 1 bath 499 sf; Plan 003 2 bed 2 bath 990 sf; Plan 004 3 bed 3 bath 1,199 sf.",
            "Some pre-approved plans may still need a design professional to finalize the plan set (for example: site plan, Title 24, structural details, soils report); each plan set notes what else is required.",
            "Pre-approved plans may also be used in the standard review process.",
        ],
        "source": PLANS_PAGE,
    },
]


def clean(text: str) -> str:
    text = text.replace("\u2610", "").replace("\uf0a7", "\u2022")
    return re.sub(r"\s+", " ", text).strip()


def main() -> int:
    lines = json.loads(LINES.read_text(encoding="utf-8"))["lines"]
    checklist = []
    for iid, a, b, label, ending, doc_type, applies in ITEMS:
        span = lines[a:b + 1]
        if len(span) != b - a + 1 or label not in span[0]["text"] or not span[-1]["text"].endswith(ending):
            raise SystemExit(f"{iid}: lines {a}-{b} no longer start with {label!r} and end with "
                             f"{ending!r}; re-check ITEMS against the extracted lines")
        pages = {l["page"] for l in span}
        assert len(pages) == 1, f"{iid} spans pages {pages}"
        x0 = min(l["box"][0] for l in span)
        y0 = min(l["box"][1] for l in span)
        x1 = max(l["box"][0] + l["box"][2] for l in span)
        y1 = max(l["box"][1] + l["box"][3] for l in span)
        checklist.append({
            "id": iid,
            "text": clean(" ".join(l["text"] for l in span)),
            "page": pages.pop(),
            "box": [round(x0, 1), round(y0, 1), round(x1 - x0, 1), round(y1 - y0, 1)],
            "doc_type": doc_type,
            "applies_to": applies,
            "source": CHECKLIST_URL,
        })
    # A line that starts with the checkbox glyph gets a ~27 pt tall box, so an item's box
    # can reach into the next item. Clip each box so it ends where the next item starts.
    for cur, nxt in zip(checklist, checklist[1:]):
        if cur["page"] == nxt["page"]:
            x, y, w, h = cur["box"]
            cur["box"][3] = round(min(h, nxt["box"][1] - y), 1)
    city = {
        "city": "Anaheim",
        "verified": True,  # reviewed by the Team 1 lead, 2026-11-07
        "checked_date": CHECKED,
        # Repo-relative copy of the public checklist PDF that the boxes refer to
        # (unchanged from the city's download; the source URL is the third source below).
        # Team 2's viewer serves it; copy it under the app's public/ folder at integration.
        "checklist_pdf": "data/docs/anaheim-adu-checklist.pdf",
        # city.schema.json: sources are plain URIs; titles and read dates go in notes.
        "sources": [ADU_PAGE, PLANS_PAGE, CHECKLIST_URL],
        "notes": (
            f"All three sources read {CHECKED}: (1) ADU Anaheim page, three ways to approve an ADU "
            "incl. ADU Express; (2) ADU Pre-Approved Plan Catalogue; (3) Accessory Dwelling Unit "
            "Submittal Requirements Checklist, Planning Services Division, NOV 2025, form Z412. "
            "Unknown: the ADU Express eligibility criteria (the city's Eligibility Tool does not "
            "publish them). Anaheim's own pages disagree on ADU Express timing; see law-flags.json."
        ),
        "fast_paths": FAST_PATHS,
        "checklist": checklist,
    }
    OUT.write_text(json.dumps(city, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT.name}: {len(checklist)} checklist items, {len(FAST_PATHS)} fast paths")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
