/**
 * FROZEN CONTRACT - do not change without telling the other team leads.
 *
 * Mirrors contracts/*.schema.json. The JSON schemas are the source of truth
 * for data on the wire; this file is the source of truth for the function
 * signatures the three lanes compile against.
 */
import type Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------- events

export const TOOL_NAMES = [
  "point_to",
  "highlight",
  "mark_item",
  "draft_field",
  "add_note",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const ITEM_STATUSES = ["complete", "missing", "unknown"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/**
 * SERVER-RENDERED statute reference. Present only when the model passed a
 * `statute_id` that resolved against a statutes.json entry with
 * `confirmed: true`. Every field is copied from that entry and none is ever
 * taken from model output.
 *
 * This is the ONLY channel through which law reaches the UI. The model cannot
 * supply a citation, and prose asserting law is dropped by the backstop
 * detector in verifier.ts. A statute number appearing in `text` is a bug.
 */
export interface StatuteRef {
  id: string;
  old: string;
  new_range: string;
  title: string;
  source_url: string;
  checked_date: string;
}

/** One agent action. Matches contracts/event.schema.json exactly. */
export interface AgentEvent {
  tool: ToolName;
  /**
   * Required for point_to, highlight, mark_item and draft_field. May be null or
   * omitted for `add_note` only, which can be a general note with no item.
   */
  item_id?: string | null;
  status?: ItemStatus;
  text?: string;
  statute_ref?: StatuteRef;
  ts: string;
}

/** What the model may pass. `statute_id` names an entry; it never carries law. */
export interface ToolInput {
  item_id?: string | null;
  status?: ItemStatus;
  text?: string;
  statute_id?: string;
}

export type StatuteResolution =
  | { ok: true; statute: StatuteRef }
  | { ok: false; reason: string };

/**
 * What the route streams. Every SSE `data:` payload is one StreamFrame.
 * `event` frames carry an AgentEvent; the rest are control frames the UI
 * uses for the action log, the stop button and the error banner.
 */
export type StreamFrame =
  | { type: "event"; event: AgentEvent }
  | { type: "status"; phase: "started" | "step" | "done" | "stopped"; step?: number; detail?: string }
  | { type: "dropped"; reason: string; event: AgentEvent }
  | { type: "refusal"; reason: string }
  | { type: "error"; code: string; message: string };

// ---------------------------------------------------------------- config

export interface ChecklistItem {
  id: string;
  text: string;
  page: number | null;
  /** [x, y, w, h] in PDF points. null means the hand cannot point at it. */
  box: [number, number, number, number] | null;
  doc_type: string;
  source: string;
}

export interface FastPath {
  id: string;
  name: string;
  rules: string[];
  source: string;
}

export interface CityConfig {
  city: string;
  verified: boolean;
  checked_date: string | null;
  sources: string[];
  notes?: string;
  fast_paths: FastPath[];
  checklist: ChecklistItem[];
}

export interface StatuteEntry {
  /** Stable slug the model names in statute_id. Falls back to `old` when absent. */
  id?: string;
  quote?: string;
  old: string;
  new_range: string;
  title: string;
  source_url: string;
  checked_date: string;
  confirmed: boolean;
}

export interface ProjectTypePack {
  type: string;
  verified: boolean;
  checked_date: string | null;
  statutes: string[];
  notes?: string;
}

export interface PacketFile {
  name: string;
  declared_type: string;
  pages?: number;
}

export interface PacketManifest {
  applicant: string;
  synthetic: true;
  scenario?: string;
  files: PacketFile[];
}

// ---------------------------------------------------------------- lane 1

/** Result of validating one tool call from the model. */
export type ValidationResult =
  | {
      ok: true;
      event: AgentEvent;
      /**
       * The statute id the model passed, shape-checked only. The LOOP resolves
       * it via resolveStatuteId and sets `event.statute_ref` from the result.
       * It is deliberately absent from `event`: an unresolved id must never
       * reach the UI.
       */
      statute_id?: string;
    }
  | { ok: false; error: string };

/**
 * Lane 1 (lib/agent/tools.ts) exports exactly this.
 * TOOL_DEFINITIONS must contain exactly five tools, in a stable order
 * (prompt caching is a prefix match - reordering invalidates the cache).
 */
export interface ToolsModule {
  TOOL_DEFINITIONS: Anthropic.Tool[];
  validateToolInput(name: string, input: unknown, city: CityConfig): ValidationResult;
}

// ---------------------------------------------------------------- lane 3

/** Result of the law-claim verifier. */
export type VerifyResult =
  | { ok: true; event: AgentEvent }
  | { ok: false; reason: string };

/** Lane 3 (lib/agent/verifier.ts) exports these. */
export interface VerifierModule {
  verifyEvent(event: AgentEvent, statutes: StatuteEntry[]): VerifyResult;
  looksLikeLawClaim(text: string): boolean;
  /** Accepts a bare array or Team 1's {about, statutes:[...]} wrapper. */
  loadStatuteTable(raw: unknown): StatuteEntry[];
  /** Fails closed: unknown or unconfirmed id resolves to an error. */
  resolveStatuteId(id: string, statutes: StatuteEntry[]): StatuteResolution;
}

// ---------------------------------------------------------------- run

export interface AgentRunRequest {
  city: string;
  projectType: string;
  question: string;
  /**
   * Browser-redacted document text. Replaces the manifest-only `packet`:
   * redaction happens client-side, so the server receives text that has
   * already had names, addresses and APNs tokenized.
   */
  documents?: Array<{ name: string; declared_type: string; text: string }>;
}

export interface AgentCaps {
  maxSteps: number;
  maxTokens: number;
}
