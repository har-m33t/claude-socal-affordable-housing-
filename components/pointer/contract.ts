// PROVISIONAL types, written by the UI lane (Team 2) from the shapes in
// docs/pointer-adu-copilot-build-plan.md, because contracts/*.schema.json had not
// landed on origin/main at 12:00. When contracts/ lands, check these against it and
// change this file only. Every component imports its types from here.

export const TOOLS = ["point_to", "highlight", "mark_item", "draft_field", "add_note"] as const;
export type Tool = (typeof TOOLS)[number];

export const STATUSES = ["complete", "missing", "unknown"] as const;
export type ItemStatus = (typeof STATUSES)[number];

/** A citation as sent by the agent. The plan doesn't fix the shape, so accept a bare URL too. */
export type RawCitation =
  | string
  | { title?: string; label?: string; url: string; checked_date?: string; quote?: string };

export interface Citation {
  title: string;
  url: string;
  checked_date?: string;
  quote?: string;
}

/**
 * SERVER-RENDERED law reference (contracts/event.schema.json $defs.statute_ref). Every field
 * is copied from a confirmed data/statutes.json entry; the model never supplies law.
 */
export interface StatuteRef {
  id: string;
  old: string;
  new_range: string;
  title: string;
  source_url: string;
  checked_date: string;
}

/** contracts/event.schema.json: one agent action `{tool, item_id, status?, text?, statute_ref?, ts}`. */
export interface AgentEvent {
  tool: Tool;
  item_id: string;
  status?: ItemStatus;
  text?: string;
  /** Legacy field; parseEvent rejects it on the wire. Kept so old fixtures type-check. */
  citation?: RawCitation;
  statute_ref?: StatuteRef;
  ts: string;
}

export interface Source {
  title: string;
  url: string;
  checked_date?: string;
}

/** contracts/city.schema.json, checklist entry. ASSUMPTION: box = [x, y, w, h] in PDF points, top-left origin. */
export interface ChecklistItem {
  id: string;
  text: string;
  page: number;
  box: [number, number, number, number] | null;
  doc_type: string;
  source: Source | string;
}

export interface FastPath {
  id: string;
  name: string;
  rules: string[];
  source: Source | string;
}

export interface CityConfig {
  city: string;
  verified: boolean;
  checked_date: string | null;
  /** NOT in the plan's schema: where the checklist PDF is served from. Proposed addition. */
  checklist_pdf?: string;
  sources: (Source | string)[];
  fast_paths: FastPath[];
  checklist: ChecklistItem[];
}

export interface ProjectType {
  type: string;
  name: string;
  verified: boolean;
  note?: string;
}

export type CoverageStatus = "live" | "checklist_found" | "not_checked";

export interface CoverageRow {
  city: string;
  status: CoverageStatus;
  verified: boolean;
  checked_date: string | null;
  checklist_url: string | null;
}

export interface PacketFile {
  name: string;
  declared_type: string;
}

export function normalizeCitation(c: RawCitation | undefined): Citation | undefined {
  if (!c) return undefined;
  if (typeof c === "string") return { title: hostOf(c), url: c };
  return { title: c.title ?? c.label ?? hostOf(c.url), url: c.url, checked_date: c.checked_date, quote: c.quote };
}

export function normalizeSource(s: Source | string): Source {
  return typeof s === "string" ? { title: hostOf(s), url: s } : s;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Only http(s) links may open. This stops `javascript:` and similar URLs in agent output. */
export function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url, "http://localhost");
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Runtime guard: events come from a network stream later, so never trust their shape. */
export function parseEvent(raw: unknown): AgentEvent | null {
  if (!raw || typeof raw !== "object") return null;
  // The route streams a StreamFrame per `data:` line. An action frame is
  // {type:"event", event:{...}}; unwrap it. A bare event is still accepted so
  // fixtures/mock-events.json keeps working.
  const frame = raw as { type?: unknown; event?: unknown };
  const source =
    frame.type === "event" && frame.event && typeof frame.event === "object"
      ? frame.event
      : raw;
  const e = source as Record<string, unknown>;
  if (!TOOLS.includes(e.tool as Tool)) return null;
  if (typeof e.ts !== "string") return null;
  // item_id is required on four tools and optional on add_note alone, which may
  // be a general note with no checklist item (confirmed by the lead on #3).
  if (e.tool === "add_note") {
    if (e.item_id !== undefined && e.item_id !== null && typeof e.item_id !== "string") return null;
  } else if (typeof e.item_id !== "string") {
    return null;
  }
  if (e.status !== undefined && !STATUSES.includes(e.status as ItemStatus)) return null;
  if (e.text !== undefined && typeof e.text !== "string") return null;
  // Law arrives ONLY as a server-rendered statute_ref. The model cannot supply
  // a citation, so a `citation` key here means something upstream is wrong.
  if (e.citation !== undefined) return null;
  if (e.statute_ref !== undefined) {
    const r = e.statute_ref as Record<string, unknown> | null;
    if (!r || typeof r !== "object") return null;
    for (const k of ["id", "old", "new_range", "title", "source_url", "checked_date"]) {
      if (typeof r[k] !== "string") return null;
    }
  }
  return source as unknown as AgentEvent;
}
