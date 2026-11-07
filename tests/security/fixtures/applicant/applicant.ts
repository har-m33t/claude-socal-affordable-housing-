/**
 * MADE UP. Not a real person.
 *
 * The fictional ADU applicant used by the redaction tests. Every value is invented:
 * 555-01xx phone numbers, example.com emails, "Example Lane", APN 999-999-99.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const APPLICANT_DOCUMENTS = [
  "owner-info-sheet.txt",
  "cover-letter.txt",
  "site-plan-notes.txt",
  "contractor-contact.txt",
] as const;

export type ApplicantDocument = (typeof APPLICANT_DOCUMENTS)[number];

export function loadApplicantDocument(name: ApplicantDocument): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), name), "utf8");
}

/** The homeowner as she would type herself into Pointer's form. */
export const KNOWN_NAMES = ["Maria Ejemplo"] as const;

/** Every one of these must be gone from redacted text (checked case-insensitively). */
export const SENSITIVE_VALUES = {
  NAME: ["Maria Ejemplo", "MARIA  EJEMPLO", "Jorge Ejemplo", "Ejemplo", "Jorge", "Daniel Testwood", "Daniel"],
  ADDRESS: ["1234 Example Lane", "P.O. Box 0101", "1 Fictional Court"],
  PHONE: ["(714) 555-0142", "714-555-0142", "714.555.0187", "+1 714 555 0187", "714-555-0110", "555-01"],
  EMAIL: ["maria.ejemplo@example.com", "dtestwood@example.com"],
  APN: ["999-999-99", "99999999"],
} as const;

/** Each of these appears in the documents and must come through redaction unchanged. */
export const MUST_SURVIVE = [
  "City of Anaheim Planning and Building Department",
  "Gov. Code 66314",
  "Gov. Code 65852.2",
  "sections 66310 to 66342",
  "January 1, 2025",
  "March 3, 2026",
  "2026-03-03",
  "$185,000",
  "Permit No. ADU-2026-0042",
  "Checklist item: Site plan showing setbacks to property lines",
  "Checklist item: Floor plan with dimensions and room labels",
  "HCD ADU Handbook",
  "Orange County",
  "Detached ADU, 750 sq ft",
  "Rear setback: 4 ft. Side setback: 4 ft.",
  "Dear Planning Staff,",
] as const;
