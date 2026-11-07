#!/usr/bin/env python3
"""Build the MADE-UP applicant packet used to demo and test Pointer.

Usage:  python data/tools/make_packet.py

Writes data/packet/: one small PDF per document plus manifest.json. Nobody in
it is real. Contact details use reserved test ranges: 555-01xx phone numbers,
example.com email, and a placeholder APN and street that do not exist. Team 4's
redaction tests use applicant.json as the list of values that must be caught.

The site plan is left out on purpose, so the demo can show a missing item.
The declared_type values are provisional until Anaheim's checklist is
extracted; they will be aligned with the checklist's doc_type keys then.
"""
from __future__ import annotations

import json
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "packet"

APPLICANT = {
    "about": "MADE UP. Not a real person, address or parcel. For demo and redaction tests only.",
    "name": "Maria Ejemplo",
    "co_owner": "Daniel Ejemplo",
    "street": "1234 Placeholder Lane",
    "city": "Anaheim",
    "state": "CA",
    "zip": "00000",
    "apn": "000-000-00",
    "phone": "714-555-0142",
    "email": "maria.ejemplo@example.com",
}

DOCS = [
    ("floor-plan.pdf", "floor_plan", "Floor plan, detached ADU, 600 sf (made-up dimensions)"),
    ("elevations.pdf", "elevations", "Exterior elevations (made-up drawing set)"),
    ("owner-affidavit.pdf", "owner_affidavit", "Owner affidavit, unsigned"),
    ("utility-letter.pdf", "unknown", "Letter about utilities; type left for the agent to classify"),
]


def pdf(lines: list[str]) -> bytes:
    """Minimal one-page PDF with Helvetica text (stdlib only)."""
    def esc(s: str) -> str:
        return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    ops = ["BT", "/F1 12 Tf", "72 720 Td", "16 TL"]
    for line in lines:
        ops.append(f"({esc(line)}) Tj T*")
    ops.append("ET")
    stream = "\n".join(ops).encode("latin-1")
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
    ]
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    return bytes(out)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    a = APPLICANT
    header = [
        "MADE-UP TEST DOCUMENT - not a real applicant, address or parcel",
        "",
        f"Owner: {a['name']} and {a['co_owner']}",
        f"Property: {a['street']}, {a['city']}, {a['state']} {a['zip']}",
        f"APN: {a['apn']}",
        f"Phone: {a['phone']}   Email: {a['email']}",
        "",
    ]
    for name, _, title in DOCS:
        (OUT / name).write_bytes(pdf(header + [title]))
    manifest = {
        "about": "MADE UP applicant packet for the Pointer demo. No real person or property. "
                 "The site plan is intentionally missing.",
        "files": [{"name": n, "declared_type": t} for n, t, _ in DOCS],
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (OUT / "applicant.json").write_text(json.dumps(APPLICANT, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(DOCS)} PDFs, manifest.json and applicant.json to {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
