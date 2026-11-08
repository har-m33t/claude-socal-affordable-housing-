#!/usr/bin/env python3
"""Generate one unverified stub city file per Orange County city.

Usage:
  python data/tools/make_stubs.py data/processed/oc-cities.json

Reads the 34-city list of Orange County's incorporated cities and writes data/cities/<slug>.json for every
city that does not already have a file, so hand-built files (anaheim.json) are
never overwritten. Every stub has verified: false and empty checklists: the app
must show "not yet verified" for these and never give advice from them.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

CITIES_DIR = Path(__file__).resolve().parent.parent / "cities"


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def stub(name: str) -> dict:
    return {"city": name, "verified": False, "checked_date": None,
            "sources": [], "fast_paths": [], "checklist": []}


def main(src: str) -> int:
    cities = json.loads(Path(src).read_text(encoding="utf-8"))["cities"]
    written = skipped = 0
    for c in cities:
        path = CITIES_DIR / f"{slug(c['name'])}.json"
        if path.exists():
            skipped += 1
            continue
        path.write_text(json.dumps(stub(c["name"]), indent=2) + "\n", encoding="utf-8")
        written += 1
    print(f"{len(cities)} cities: wrote {written} stubs, kept {skipped} existing files")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1]))
