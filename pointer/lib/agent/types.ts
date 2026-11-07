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

export interface Citation {
  source_url: string;
  checked_date: string;
  detail?: string;
}

/** One agent action. Matches contracts/event.schema.json exactly. */
export interface AgentEvent {
  tool: ToolName;
  item_id: string;
  status?: ItemStatus;
  text?: string;
  citation?: Citation;
  ts: string;
}

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
  | { ok: true; event: AgentEvent }
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

/** Lane 3 (lib/agent/verifier.ts, recorder.ts, replay.ts) exports these. */
export interface VerifierModule {
  verifyEvent(event: AgentEvent, statutes: StatuteEntry[]): VerifyResult;
  looksLikeLawClaim(text: string): boolean;
}

export interface RecorderHandle {
  record(frame: StreamFrame): void;
  /** Writes fixtures/replay.json and returns the path written. */
  save(): Promise<string>;
}

// ---------------------------------------------------------------- run

export interface AgentRunRequest {
  city: string;
  projectType: string;
  question: string;
  packet?: PacketManifest;
  /** When true, stream fixtures/replay.json instead of calling the API. */
  replay?: boolean;
  /** When true, write a replay file for this run. */
  record?: boolean;
}

export interface AgentCaps {
  maxSteps: number;
  maxTokens: number;
}
