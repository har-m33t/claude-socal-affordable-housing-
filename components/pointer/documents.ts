// FROZEN CONTRACT (lead). A file the homeowner added on this device.
//
// Only the REDACTED text ever exists here: the original file and the token map stay
// inside the file board's redactor session. The live run sends `text` to /api/agent;
// nothing else about the file leaves the browser.

export interface AddedDocument {
  id: string;
  name: string;
  /** The plan slot (target id) the homeowner chose for this file. Never guessed. */
  slotId: string;
  /** Declared type for the agent: the slot's document type, e.g. "site_plan". */
  declared_type: string;
  kind: "pdf" | "png" | "jpeg";
  size: number;
  /** Redacted text. Empty for images (no text layer is read from images). */
  text: string;
  /** How many personal details the redactor hid. */
  hidden: number;
}
