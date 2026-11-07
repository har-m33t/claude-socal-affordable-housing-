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
 * Two guards matter most:
 *   1. checklist membership - the model must not point the hand at an item that
 *      does not exist in the loaded city file;
 *   2. statute_id is SHAPE-CHECKED ONLY here. This function never resolves it.
 *      Resolution against the verified statute table is verifier.ts's job
 *      (resolveStatuteId), and the loop renders the result into
 *      `event.statute_ref`. A statute_id that passes this function is not yet
 *      trusted - it is merely a plausible lookup key.
 *
 * `statute_id` is model input, not event output, so it is deliberately NOT
 * written onto the returned AgentEvent. It comes back as a sibling field on the
 * success result for the loop to resolve.
 */
import { z } from "zod";

import {
  ITEM_STATUSES,
  TOOL_NAMES,
  type AgentEvent,
  type CityConfig,
  type ToolName,
} from "./types";

/**
 * What validateToolInput returns.
 *
 * This is a superset of `ValidationResult` in types.ts: the success branch
 * carries the parsed `statute_id` alongside the event. It is assignable to
 * `ValidationResult`, so lib/agent/tools.ts still satisfies the frozen
 * `ToolsModule` interface. Lead: the additive change I want in types.ts is
 * exactly
 *
 *   export type ValidationResult =
 *     | { ok: true; event: AgentEvent; statute_id?: string }
 *     | { ok: false; error: string };
 *
 * and this local alias can then be deleted in favour of it.
 */
export type ToolValidationResult =
  | { ok: true; event: AgentEvent; statute_id?: string }
  | { ok: false; error: string };

// ---------------------------------------------------------------- schemas

const itemIdSchema = z.string().min(1);

/** draft_field / add_note text. 4000 is from contracts/event.schema.json. */
const textSchema = z.string().max(4000);

/** mark_item status. Mirrors ITEM_STATUSES in types.ts. */
const statusSchema = z.enum(ITEM_STATUSES);

/**
 * A lookup key into the verified statute table - never law itself. Trimmed
 * first, so a whitespace-only id is rejected as empty rather than silently
 * becoming one. 120 chars is far longer than any real slug; the cap exists to
 * stop a truncated eager stream dumping prose into this field.
 */
const statuteIdSchema = z.string().trim().min(1).max(120);

const pointerToolSchema = z.strictObject({
  item_id: itemIdSchema,
});

const markItemSchema = z.strictObject({
  item_id: itemIdSchema,
  status: statusSchema,
  statute_id: statuteIdSchema.optional(),
});

const draftFieldSchema = z.strictObject({
  item_id: itemIdSchema,
  text: textSchema,
  statute_id: statuteIdSchema.optional(),
});

/** add_note is the only tool whose item_id may be absent or null. */
const addNoteSchema = z.strictObject({
  item_id: itemIdSchema.optional(),
  text: textSchema,
  statute_id: statuteIdSchema.optional(),
});

/** One schema per tool name. Keys match TOOL_NAMES exactly. */
const SCHEMAS = {
  point_to: pointerToolSchema,
  highlight: pointerToolSchema,
  mark_item: markItemSchema,
  draft_field: draftFieldSchema,
  add_note: addNoteSchema,
} satisfies Record<ToolName, z.ZodTypeAny>;

/** The tools whose schemas declare statute_id. */
const LAW_TOOLS: ReadonlySet<string> = new Set(["mark_item", "draft_field", "add_note"]);

/** The tools that require an item_id. Only add_note may go without one. */
const ITEM_REQUIRED: ReadonlySet<string> = new Set([
  "point_to",
  "highlight",
  "mark_item",
  "draft_field",
]);

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

function fail(message: string): ToolValidationResult {
  return { ok: false, error: message };
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

// ---------------------------------------------------------------- public

/**
 * Validate one tool call from the model against the loaded city.
 *
 * Returns `{ ok: true, event, statute_id? }` with a wire-ready AgentEvent
 * (including an ISO `ts`, and never a `statute_ref`), or
 * `{ ok: false, error }` with a short message naming what was wrong.
 * Never throws.
 */
export function validateToolInput(
  name: string,
  input: unknown,
  city: CityConfig,
): ToolValidationResult {
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
    if ("statute_id" in raw && !LAW_TOOLS.has(name)) {
      return fail(
        `${name}: "statute_id" is only allowed on mark_item, draft_field and add_note`,
      );
    }

    // 4. item_id presence. Required everywhere but add_note, which may carry a
    //    note about the application as a whole. `null` means "not supplied".
    const itemIdSupplied = raw.item_id !== undefined && raw.item_id !== null;
    if (!itemIdSupplied && ITEM_REQUIRED.has(name)) {
      return fail(
        `${name}: "item_id" is required and must name an item in the loaded checklist`,
      );
    }

    // 5. Normalise the nullable fields to "absent" before the schema runs. The
    //    tool schemas type these as ["string", "null"], so an explicit null is
    //    a legitimate way for the model to say "none".
    const normalised: Record<string, unknown> = { ...raw };
    if (normalised.item_id === null) delete normalised.item_id;
    if (normalised.statute_id === null) delete normalised.statute_id;

    // 6. The per-tool schema: required fields present, types right, text within
    //    4000 chars, status in the enum, statute_id a sane lookup key, no extras.
    const parsed = SCHEMAS[name].safeParse(normalised);
    if (!parsed.success) {
      return fail(`${name}: ${describeIssue(parsed.error)}`);
    }
    const data = parsed.data as {
      item_id?: string;
      status?: "complete" | "missing" | "unknown";
      text?: string;
      statute_id?: string;
    };

    // 7. THE CORE GUARD. The item has to exist in the city we actually loaded.
    if (data.item_id !== undefined) {
      const checklist = Array.isArray(city?.checklist) ? city.checklist : [];
      if (!checklist.some((item) => item?.id === data.item_id)) {
        return fail(
          `${name}: unknown item_id "${data.item_id}" - not in the ` +
            `${city?.city ?? "loaded"} checklist`,
        );
      }
    }

    // 8. Build the event. Optional fields are omitted, not set to undefined, so
    //    JSON.stringify matches contracts/event.schema.json exactly. statute_id
    //    is NOT an event field: the loop resolves it into statute_ref, which
    //    only ever comes from the verified statute table.
    const event: AgentEvent = {
      tool: name,
      ts: new Date().toISOString(),
    };
    if (data.item_id !== undefined) event.item_id = data.item_id;
    if (data.status !== undefined) event.status = data.status;
    if (data.text !== undefined) event.text = data.text;

    return data.statute_id !== undefined
      ? { ok: true, event, statute_id: data.statute_id }
      : { ok: true, event };
  } catch (err) {
    // Belt and braces: bad model input must never take the loop down.
    const detail = err instanceof Error ? err.message : String(err);
    return fail(`${name}: could not validate input (${detail})`);
  }
}
