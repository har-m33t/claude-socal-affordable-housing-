#!/usr/bin/env python3
"""Build the MADE-UP applicant packet used to demo and test Pointer.

Usage:  python data/tools/make_packet.py

Writes data/packet/: one small PDF per document plus manifest.json. Nobody in
it is real. Contact details use reserved test ranges: 555-01xx phone numbers,
example.com email, and a placeholder APN and street that do not exist. Team 4's
redaction tests use applicant.json as the list of values that must be caught.

declared_type values match the doc_type keys in cities/anaheim.json. The
applicant is adding a detached ADU (no JADU), so the three JADU items do not
apply. The ADU gets a new electric meter, which makes the conditional meter spot
report item apply. Demo gaps, on purpose: the new address request is missing its site
plan, and there is no meter spot report. The floor plan is not a Planning
checklist item and is declared unknown for the agent to classify.
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
    ("sewer-capacity-email.pdf", "sewer_capacity_verification",
     "Made-up email reply confirming sewer capacity for one detached ADU"),
    ("new-address-request.pdf", "new_address_request",
     "Made-up New Address Request Application. Site plan: NOT ATTACHED"),
    ("floor-plan.pdf", "unknown",
     "Made-up floor plan, detached ADU, Plan 002 style, 1 bed 1 bath"),
]
STALE = ["elevations.pdf", "owner-affidavit.pdf", "utility-letter.pdf"]


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
    for name in STALE:
        (OUT / name).unlink(missing_ok=True)
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
    manifest = {  # packet.schema.json
        "applicant": f"{a['name']} (made up)",
        "synthetic": True,
        "scenario": "MADE UP applicant packet for the Pointer demo. No real person or property. "
                    "Detached ADU with a new electric meter, no JADU, so the meter spot report "
                    "is required. Intentionally missing: the site plan for the new address "
                    "request, and the meter spot report.",
        "files": [{"name": n, "declared_type": t} for n, t, _ in DOCS],
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (OUT / "applicant.json").write_text(json.dumps(APPLICANT, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(DOCS)} PDFs, manifest.json and applicant.json to {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
