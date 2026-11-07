#!/usr/bin/env python3
"""Validate Team 1's data files.

Usage:  python -I data/tools/validate.py

If contracts/*.schema.json exist and the jsonschema package is installed, each
file is also validated against its contract. The built-in checks below always
run; they encode the plan's field lists and its sourcing rules:

- every city has the plan's fields, and verified is a real boolean; a verified
  city needs a checked_date, a non-empty checklist and only dated sources
- checklist items have id, text, doc_type and source; ids are unique; page >= 1;
  box is 4 numbers; boxes on the same page do not overlap
- every statute has a source_url; confirmed: true needs a checked_date
- type packs: verified: true needs a checked_date and only confirmed statutes
- law flags quote both sides, cite both sources and point at a real item
- the packet manifest says it is made up, every file it lists exists, and every
  declared_type is a checklist doc_type or unknown
Problems are reported, never raised. Exit code 1 if anything fails.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent
ROOT = DATA.parent
CONTRACTS = ROOT / "contracts"

errors: list[str] = []
MISSING = object()


def err(path: Path, msg: str) -> None:
    errors.append(f"{path.relative_to(ROOT)}: {msg}")


def load(path: Path, required: bool = True):
    if not path.exists():
        if required:
            err(path, "file is missing")
        return MISSING
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as e:
        err(path, f"cannot read: {e}")
        return MISSING


def schema_check(path: Path, doc, schema_name: str) -> None:
    schema_path = CONTRACTS / schema_name
    if not schema_path.exists():
        return
    try:
        import jsonschema
    except ImportError:
        err(path, "jsonschema not installed; run pip install jsonschema to check contracts")
        return
    schema = load(schema_path)
    if schema is MISSING:
        return
    for e in jsonschema.Draft202012Validator(schema).iter_errors(doc):
        where = "/".join(str(p) for p in e.absolute_path) or "(root)"
        err(path, f"{schema_name} at {where}: {e.message}")


def overlaps(a: list, b: list) -> bool:
    return a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]


def check_city(path: Path, c: dict) -> None:
    for k in ("city", "verified", "checked_date", "sources", "fast_paths", "checklist"):
        if k not in c:
            err(path, f"missing field {k}")
    if not isinstance(c.get("verified"), bool):
        err(path, f"verified must be true or false, got {c.get('verified')!r}")
    if c.get("verified") is True:
        if not c.get("checked_date"):
            err(path, "verified city needs checked_date")
        if not c.get("checklist"):
            err(path, "verified city needs a checklist")
    if c.get("checklist") and not c.get("checklist_pdf"):
        err(path, "a city with checklist boxes needs checklist_pdf, the PDF the boxes refer to")
    if c.get("checklist_pdf") and not (ROOT / c["checklist_pdf"]).is_file():
        err(path, f"checklist_pdf not found: {c['checklist_pdf']}")
    for s in c.get("sources", []):
        if not str(s.get("url", "")).startswith("https://"):
            err(path, f"source without https url: {s.get('title')}")
        if c.get("verified") is True and not s.get("checked_date"):
            err(path, f"verified city has an undated source: {s.get('title')}")
    for fp in c.get("fast_paths", []):
        if not fp.get("source"):
            err(path, f"fast path {fp.get('id')} has no source")
    seen, boxed = set(), []
    for n, item in enumerate(c.get("checklist", [])):
        iid = item.get("id") or f"item #{n}"
        for k in ("id", "text", "doc_type", "source"):
            if not item.get(k):
                err(path, f"{iid}: missing {k}")
        if iid in seen:
            err(path, f"duplicate checklist id {iid}")
        seen.add(iid)
        page, box = item.get("page"), item.get("box")
        if not isinstance(page, int) or page < 1:
            err(path, f"{iid}: page must be an integer >= 1")
        if not (isinstance(box, list) and len(box) == 4 and all(isinstance(v, (int, float)) for v in box)):
            err(path, f"{iid}: box must be [x, y, w, h]")
            continue
        for other_id, other_page, other_box in boxed:
            if other_page == page and overlaps(box, other_box):
                err(path, f"{iid}: box overlaps {other_id}")
        boxed.append((iid, page, box))
    schema_check(path, c, "city.schema.json")


def check_statutes(path: Path, doc: dict) -> None:
    for s in doc.get("statutes", []):
        if not s.get("source_url"):
            err(path, f"{s.get('old')}: no source_url")
        if s.get("confirmed") and not s.get("checked_date"):
            err(path, f"{s.get('old')}: confirmed needs checked_date")
        schema_check(path, s, "statute.schema.json")


def check_type(path: Path, t: dict) -> None:
    if not isinstance(t.get("verified"), bool):
        err(path, f"verified must be true or false, got {t.get('verified')!r}")
    if t.get("verified") is True:
        if not t.get("checked_date"):
            err(path, "verified type pack needs checked_date")
        for k in ("statutes", "clocks"):
            for e in t.get(k, []):
                if e.get("confirmed") is not True:
                    err(path, f"verified pack has unconfirmed {k[:-1]} {e.get('section') or e.get('id')}")
    for s in t.get("statutes", []):
        if not s.get("source_url"):
            err(path, f"statute {s.get('section')} has no source_url")


def check_flags(path: Path, doc: dict, cities: dict[str, dict]) -> None:
    for f in doc.get("flags", []):
        fid = f.get("id") or "(flag without id)"
        for k in ("id", "city_says", "current", "city_source", "current_source", "checked_date"):
            if not f.get(k):
                err(path, f"{fid}: missing {k}")
        city = cities.get(f.get("city"))
        if city is None:
            err(path, f"{fid}: unknown city {f.get('city')}")
        elif f.get("item_id") and f["item_id"] not in {i.get("id") for i in city.get("checklist", [])}:
            err(path, f"{fid}: item_id {f['item_id']} not in {f['city']}.json")


def check_packet(path: Path, p: dict, doc_types: set[str]) -> None:
    if "made up" not in p.get("about", "").lower():
        err(path, "packet 'about' must say the applicant is made up")
    for n, f in enumerate(p.get("files", [])):
        name = f.get("name")
        if not name:
            err(path, f"file #{n} has no name")
            continue
        if not (path.parent / name).exists():
            err(path, f"listed file missing: {name}")
        if f.get("declared_type") not in doc_types | {"unknown"}:
            err(path, f"{name}: declared_type {f.get('declared_type')} is not a checklist doc_type")
    schema_check(path, {"files": p.get("files", [])}, "packet.schema.json")


def main() -> int:
    cities: dict[str, dict] = {}
    for path in sorted((DATA / "cities").glob("*.json")):
        if path.name.startswith("_"):
            continue
        c = load(path)
        if c is not MISSING:
            check_city(path, c)
            cities[path.stem] = c
    statutes = DATA / "statutes.json"
    if (doc := load(statutes)) is not MISSING:
        check_statutes(statutes, doc)
    types = sorted((DATA / "types").glob("*.json"))
    for path in types:
        if (t := load(path)) is not MISSING:
            check_type(path, t)
    flags = DATA / "law-flags.json"
    if (doc := load(flags, required=False)) is not MISSING:
        check_flags(flags, doc, cities)
    doc_types = {i.get("doc_type") for c in cities.values() for i in c.get("checklist", [])} - {None}
    manifest = DATA / "packet" / "manifest.json"
    if (p := load(manifest, required=False)) is not MISSING:
        check_packet(manifest, p, doc_types)

    verified = sum(1 for c in cities.values() if c.get("verified") is True)
    print(f"{len(cities)} city files ({verified} verified), {len(types)} type packs, "
          f"contracts {'found' if CONTRACTS.exists() else 'not found (built-in checks only)'}")
    if errors:
        print("\n".join(f"FAIL {e}" for e in errors))
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
