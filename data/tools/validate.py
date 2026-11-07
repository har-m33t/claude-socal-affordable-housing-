#!/usr/bin/env python3
"""Validate Team 1's data files.

Usage:  python data/tools/validate.py

If contracts/*.schema.json exist and the jsonschema package is installed, each
file is also validated against its contract. The built-in checks below always
run; they encode the plan's field lists and its sourcing rules:

- every city has the plan's fields; a city with verified: true must have a
  checked_date, at least one dated source, and a non-empty checklist
- checklist ids are unique; each item has page >= 1 and a 4-number box
- every statute has a source_url; confirmed: true needs a checked_date
- type packs: verified: true needs a checked_date
- the packet manifest says it is made up and every file it lists exists
Exit code 1 if anything fails.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent
ROOT = DATA.parent
CONTRACTS = ROOT / "contracts"

errors: list[str] = []


def err(path: Path, msg: str) -> None:
    errors.append(f"{path.relative_to(ROOT)}: {msg}")


def load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        err(path, f"invalid JSON: {e}")
        return None


def schema_check(path: Path, doc, schema_name: str) -> None:
    schema_path = CONTRACTS / schema_name
    if not schema_path.exists():
        return
    try:
        import jsonschema
    except ImportError:
        print("note: jsonschema not installed; skipping contract validation")
        return
    try:
        jsonschema.validate(doc, json.loads(schema_path.read_text(encoding="utf-8")))
    except jsonschema.ValidationError as e:
        err(path, f"{schema_name}: {e.message}")


def check_city(path: Path, c: dict) -> None:
    for k in ("city", "verified", "checked_date", "sources", "fast_paths", "checklist"):
        if k not in c:
            err(path, f"missing field {k}")
    if c.get("verified"):
        if not c.get("checked_date"):
            err(path, "verified city needs checked_date")
        if not c.get("checklist"):
            err(path, "verified city needs a checklist")
        if not any(s.get("checked_date") for s in c.get("sources", [])):
            err(path, "verified city needs at least one dated source")
    for s in c.get("sources", []):
        if not str(s.get("url", "")).startswith("https://"):
            err(path, f"source without https url: {s.get('title')}")
        if c.get("checklist") and not s.get("checked_date"):
            err(path, f"source without checked_date: {s.get('title')}")
    for fp in c.get("fast_paths", []):
        if not fp.get("source"):
            err(path, f"fast path {fp.get('id')} has no source")
    seen = set()
    for item in c.get("checklist", []):
        iid = item.get("id")
        if iid in seen:
            err(path, f"duplicate checklist id {iid}")
        seen.add(iid)
        if not isinstance(item.get("page"), int) or item["page"] < 1:
            err(path, f"{iid}: page must be an integer >= 1")
        box = item.get("box")
        if not (isinstance(box, list) and len(box) == 4 and all(isinstance(v, (int, float)) for v in box)):
            err(path, f"{iid}: box must be [x, y, w, h]")
        if not item.get("source"):
            err(path, f"{iid}: no source")
    schema_check(path, c, "city.schema.json")


def check_statutes(path: Path, doc: dict) -> None:
    for s in doc.get("statutes", []):
        if not s.get("source_url"):
            err(path, f"{s.get('old')}: no source_url")
        if s.get("confirmed") and not s.get("checked_date"):
            err(path, f"{s.get('old')}: confirmed needs checked_date")
        schema_check(path, s, "statute.schema.json")


def check_type(path: Path, t: dict) -> None:
    if t.get("verified") and not t.get("checked_date"):
        err(path, "verified type pack needs checked_date")
    for s in t.get("statutes", []):
        if not s.get("source_url"):
            err(path, f"statute {s.get('section')} has no source_url")


def check_flags(path: Path, doc: dict, cities: dict[str, dict]) -> None:
    for f in doc.get("flags", []):
        fid = f.get("id")
        for k in ("city_says", "current", "city_source", "state_source", "checked_date"):
            if not f.get(k):
                err(path, f"{fid}: missing {k}")
        city = cities.get(f.get("city"))
        if city is None:
            err(path, f"{fid}: unknown city {f.get('city')}")
        elif f.get("item_id") and f["item_id"] not in {i["id"] for i in city.get("checklist", [])}:
            err(path, f"{fid}: item_id {f['item_id']} not in {f['city']}.json")


def check_packet(path: Path, p: dict, doc_types: set[str]) -> None:
    if "made up" not in p.get("about", "").lower():
        err(path, "packet 'about' must say the applicant is made up")
    for f in p.get("files", []):
        if not (path.parent / f["name"]).exists():
            err(path, f"listed file missing: {f['name']}")
        if f.get("declared_type") not in doc_types | {"unknown"}:
            err(path, f"{f['name']}: declared_type {f.get('declared_type')} is not a checklist doc_type")
    schema_check(path, {"files": p.get("files", [])}, "packet.schema.json")


def main() -> int:
    cities = sorted((DATA / "cities").glob("*.json"))
    by_slug: dict[str, dict] = {}
    for path in cities:
        if path.name.startswith("_"):
            continue
        c = load(path)
        if c is not None:
            check_city(path, c)
            by_slug[path.stem] = c
    if (flags := DATA / "law-flags.json").exists() and (doc := load(flags)) is not None:
        check_flags(flags, doc, by_slug)
    doc_types = {i["doc_type"] for c in by_slug.values() for i in c.get("checklist", [])}
    if (doc := load(DATA / "statutes.json")) is not None:
        check_statutes(DATA / "statutes.json", doc)
    for path in sorted((DATA / "types").glob("*.json")):
        if (t := load(path)) is not None:
            check_type(path, t)
    manifest = DATA / "packet" / "manifest.json"
    if manifest.exists() and (p := load(manifest)) is not None:
        check_packet(manifest, p, doc_types)

    real = [p for p in cities if not p.name.startswith("_")]
    verified = sum(1 for p in real if (load(p) or {}).get("verified"))
    print(f"{len(real)} city files ({verified} verified), "
          f"{len(list((DATA / 'types').glob('*.json')))} type packs, "
          f"contracts {'found' if CONTRACTS.exists() else 'not found (built-in checks only)'}")
    if errors:
        print("\n".join(f"FAIL {e}" for e in errors))
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
