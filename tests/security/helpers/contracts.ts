/**
 * Frozen shared contracts, encoded for the security tests.
 *
 * Source: contracts/*.schema.json. `contracts/`
 * does not exist yet; when it does, these shapes must stay in line with it (or be
 * replaced by imports from it). Only the fields the security checks depend on are
 * modelled here.
 */

/** The only tools the agent may expose or stream. Exactly these five, no more. */
export const ALLOWED_TOOLS = [
  "point_to",
  "highlight",
  "mark_item",
  "draft_field",
  "add_note",
] as const;
export type AllowedTool = (typeof ALLOWED_TOOLS)[number];

export const MARK_ITEM_STATUSES = ["complete", "missing", "unknown"] as const;

/** One agent action streamed to the browser: `{tool, item_id, status?, text?, citation?, ts}`. */
export interface AgentEvent {
  tool: string;
  item_id?: string | null;
  status?: string;
  text?: string;
  citation?: unknown;
  ts?: number | string;
  [extra: string]: unknown;
}

export interface ChecklistItem {
  id: string;
  text: string;
  page: number;
  box: [number, number, number, number];
  doc_type: string;
  source: string;
}

/** `{city, verified, checked_date, sources[], fast_paths[...], checklist[...]}` */
export interface CityConfig {
  city: string;
  verified: boolean;
  checked_date?: string | null;
  sources?: unknown[];
  fast_paths?: unknown[];
  checklist?: ChecklistItem[];
}

export function isAllowedTool(name: unknown): name is AllowedTool {
  return typeof name === "string" && (ALLOWED_TOOLS as readonly string[]).includes(name);
}

export function checklistIds(city: CityConfig): Set<string> {
  return new Set((city.checklist ?? []).map((item) => item.id));
}
