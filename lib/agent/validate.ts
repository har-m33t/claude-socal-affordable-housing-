/**
 * Lane 1: zod validation for every tool call the model makes.
 *
 * This is the only thing standing between the model and the UI. The tool
 * definitions set `eager_input_streaming: true`, which means the server no
 * longer validates tool input and the SDK's tolerant JSON parser can hand the
 * loop a silently truncated input object. So:
 *
 *   - validateToolInput() is mandatory on every tool_use block, with no
 *     fast path and no "the schema is strict so it must be fine";
 *   - it NEVER throws on bad model input. Everything that can go wrong comes
 *     back as { ok: false, error } so the loop can emit a `dropped` frame and
 *     let the model try again.
 *
 * The core guard is checklist membership: the model must not point the hand at
 * an item that does not exist in the loaded city file.
 */
import { z } from "zod";

import {
  TOOL_NAMES,
  type AgentEvent,
  type Citation,
  type CityConfig,
  type ToolName,
  type ValidationResult,
} from "./types";

// ---------------------------------------------------------------- schemas

/** Matches contracts/event.schema.json $defs/citation. */
const citationSchema = z.strictObject({
  source_url: z.url(),
  checked_date: z.iso.date(),
  detail: z.string().max(500).optional(),
});

const itemIdSchema = z.string().min(1);

/** draft_field / add_note text. 4000 is from contracts/event.schema.json. */
const textSchema = z.string().max(4000);

/** mark_item status. Mirrors ITEM_STATUSES in types.ts. */
const statusSchema = z.enum(["complete", "missing", "unknown"]);

const pointerToolSchema = z.strictObject({
  item_id: itemIdSchema,
  citation: citationSchema.optional(),
});

const markItemSchema = z.strictObject({
  item_id: itemIdSchema,
  status: statusSchema,
  citation: citationSchema.optional(),
});

const textToolSchema = z.strictObject({
  item_id: itemIdSchema,
  text: textSchema,
  citation: citationSchema.optional(),
});

/** One schema per tool name. Keys match TOOL_NAMES exactly. */
const SCHEMAS = {
  point_to: pointerToolSchema,
  highlight: pointerToolSchema,
  mark_item: markItemSchema,
  draft_field: textToolSchema,
  add_note: textToolSchema,
} satisfies Record<ToolName, z.ZodTypeAny>;

// ---------------------------------------------------------------- helpers

function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

/** Flatten the first zod issue into one short human-readable clause. */
function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "invalid input";
  const path = issue.path.map((p) => String(p)).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

function fail(message: string): ValidationResult {
  return { ok: false, error: message };
}

// ---------------------------------------------------------------- public

/**
 * Validate one tool call from the model against the loaded city.
 *
 * Returns `{ ok: true, event }` with a wire-ready AgentEvent (including an ISO
 * `ts`), or `{ ok: false, error }` with a short message naming what was wrong.
 * Never throws.
 */
export function validateToolInput(
  name: string,
  input: unknown,
  city: CityConfig,
): ValidationResult {
  try {
    // 1. Unknown tool name. The model can hallucinate a tool that is not loaded.
    if (!isToolName(name)) {
      return fail(
        `unknown tool "${name}": expected one of ${TOOL_NAMES.join(", ")}`,
      );
    }

    // 2. The input has to be a plain object at all. A truncated eager stream can
    //    yield null, a bare string, or an array.
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return fail(`${name}: input must be an object, got ${describeType(input)}`);
    }
    const raw = input as Record<string, unknown>;

    // 3. Field placement. Checked before the schema so the error says which
    //    field was wrong for this tool rather than "unrecognized key".
    if ("status" in raw && name !== "mark_item") {
      return fail(`${name}: "status" is only allowed on mark_item`);
    }
    if ("text" in raw && name !== "draft_field" && name !== "add_note") {
      return fail(`${name}: "text" is only allowed on draft_field and add_note`);
    }

    // 4. The per-tool schema: required fields present, types right, text within
    //    4000 chars, status in the enum, no extra keys, citation well formed.
    const parsed = SCHEMAS[name].safeParse(raw);
    if (!parsed.success) {
      return fail(`${name}: ${describeIssue(parsed.error)}`);
    }
    const data = parsed.data as {
      item_id: string;
      status?: "complete" | "missing" | "unknown";
      text?: string;
      citation?: Citation;
    };

    // 5. THE CORE GUARD. The item has to exist in the city we actually loaded.
    const checklist = Array.isArray(city?.checklist) ? city.checklist : [];
    if (!checklist.some((item) => item?.id === data.item_id)) {
      return fail(
        `${name}: unknown item_id "${data.item_id}" - not in the ` +
          `${city?.city ?? "loaded"} checklist`,
      );
    }

    // 6. Build the event. Optional fields are omitted, not set to undefined,
    //    so JSON.stringify matches contracts/event.schema.json exactly.
    const event: AgentEvent = {
      tool: name,
      item_id: data.item_id,
      ts: new Date().toISOString(),
    };
    if (data.status !== undefined) event.status = data.status;
    if (data.text !== undefined) event.text = data.text;
    if (data.citation !== undefined) event.citation = data.citation;

    return { ok: true, event };
  } catch (err) {
    // Belt and braces: bad model input must never take the loop down.
    const detail = err instanceof Error ? err.message : String(err);
    return fail(`${name}: could not validate input (${detail})`);
  }
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
