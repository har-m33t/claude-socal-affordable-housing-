/**
 * Real data in the repo: fail if committed app data looks like it holds personal information.
 *
 * Reuses the in-browser redactor's detectors over data/, fixtures/ and contracts/
 * (data/raw/ is git-ignored and never scanned). Only clearly fictional values pass:
 * @example.* emails, 555-01xx phones and 999-* or 000-* APNs. Public agency contacts
 * (.gov / city domains) are allowed for emails. Phones and addresses of agencies
 * are public, so only emails and APNs are enforced here; names cannot be detected
 * reliably by pattern, which the README says plainly.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { redact } from "@/lib/redact";

const ROOT = join(__dirname, "..", "..");
const SCAN_DIRS = ["data", "fixtures", "contracts"];
const SKIP_DIRS = new Set(["raw", "node_modules", ".next"]);
const TEXT_EXT = /\.(json|csv|txt|md|ts|tsx|yml|yaml)$/i;

const ALLOWED_EMAIL = /@(example\.(com|org|net)|[a-z0-9.-]+\.gov|[a-z0-9.-]+\.ca\.gov|anaheim\.net)$/i;
const FICTIONAL_APN = /^(999|000)-/;

function listFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return SKIP_DIRS.has(name) ? [] : listFiles(path);
    return TEXT_EXT.test(name) ? [path] : [];
  });
}

export function personalDataFindings(file: string, text: string): string[] {
  const { spans } = redact(text);
  return spans.flatMap((span) => {
    const value = text.slice(span.start, span.end).trim();
    if (span.kind === "EMAIL" && !ALLOWED_EMAIL.test(value)) return [`${file}: email ${value}`];
    if (span.kind === "APN" && !FICTIONAL_APN.test(value.replace(/^\D+/, ""))) return [`${file}: APN ${value}`];
    return [];
  });
}

describe("no personal data in committed app data", () => {
  it("data/, fixtures/ and contracts/ hold no real-looking emails or APNs", () => {
    const files = SCAN_DIRS.flatMap((d) => listFiles(join(ROOT, d)));
    const findings = files.flatMap((f) => personalDataFindings(relative(ROOT, f), readFileSync(f, "utf8")));
    expect(findings, "Looks like personal data. Remove it, or use a made-up value (@example.com, 999-xxx-xx or 000-000-00).").toEqual([]);
  });

  it("the check catches a real-looking email and APN, and passes fictional ones", () => {
    const sample = "Owner email jane.doe@gmail.com, APN 123-456-78. Test: maria@example.com, APN 999-999-99. City: planning@anaheim.net";
    expect(personalDataFindings("sample", sample)).toEqual([
      "sample: email jane.doe@gmail.com",
      "sample: APN 123-456-78",
    ]);
  });
});
