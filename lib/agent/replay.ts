/**
 * Lane 3: replay mode.
 *
 * Reads a recorded run back from disk so the demo can run with no API key and
 * no network. The file on disk is untrusted input: a corrupt or hand-edited
 * replay file must NOT be able to push arbitrary frames into the UI, so every
 * frame is validated against the frozen `StreamFrame` union before it is
 * returned, and anything that does not match rejects the whole load.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ITEM_STATUSES, TOOL_NAMES, type StreamFrame } from "./types";

/**
 * Where a recorded run lives by default. Resolved against the process working
 * directory, which is the `pointer/` app root for `next dev`, `next start` and
 * `vitest` alike.
 */
export const DEFAULT_REPLAY_PATH = path.join("fixtures", "replay.json");

// ----------------------------------------------------------------- schema

const citationSchema = z.strictObject({
  source_url: z.string(),
  checked_date: z.string(),
  detail: z.string().max(500).optional(),
});

/** Mirrors contracts/event.schema.json. Strict: unknown keys are rejected. */
const agentEventSchema = z.strictObject({
  tool: z.enum(TOOL_NAMES),
  item_id: z.string().min(1),
  status: z.enum(ITEM_STATUSES).optional(),
  text: z.string().max(4000).optional(),
  citation: citationSchema.optional(),
  ts: z.string().min(1),
});

/** Mirrors the StreamFrame union in types.ts. */
export const streamFrameSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("event"), event: agentEventSchema }),
  z.strictObject({
    type: z.literal("status"),
    phase: z.enum(["started", "step", "done", "stopped"]),
    step: z.number().optional(),
    detail: z.string().optional(),
  }),
  z.strictObject({ type: z.literal("dropped"), reason: z.string(), event: agentEventSchema }),
  z.strictObject({ type: z.literal("refusal"), reason: z.string() }),
  z.strictObject({ type: z.literal("error"), code: z.string(), message: z.string() }),
]);

export const replayFileSchema = z.array(streamFrameSchema);

// Compile-time proof that what the schema produces is exactly a StreamFrame.
// If types.ts and this schema ever drift, tsc fails here instead of the demo
// failing in front of a user.
const _assertFrameShape: (frame: z.infer<typeof streamFrameSchema>) => StreamFrame = (frame) => frame;
void _assertFrameShape;

// ------------------------------------------------------------------ load

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function summarizeIssues(error: z.ZodError): string {
  const issues = error.issues.slice(0, 3).map((issue) => {
    const where = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${where}: ${issue.message}`;
  });
  const extra = error.issues.length > issues.length ? ` (+${error.issues.length - issues.length} more)` : "";
  return issues.join("; ") + extra;
}

/**
 * Load and validate a recorded run. Rejects with a specific error when the
 * file is missing, is not JSON, is not an array, or holds anything that is not
 * a well-formed StreamFrame.
 */
export async function loadReplay(replayPath: string = DEFAULT_REPLAY_PATH): Promise<StreamFrame[]> {
  const resolved = path.resolve(replayPath);

  let raw: string;
  try {
    raw = await fs.readFile(resolved, "utf8");
  } catch (err) {
    throw new Error(`replay file could not be read at ${resolved}: ${describe(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`replay file ${resolved} is not valid JSON: ${describe(err)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      `replay file ${resolved} must be a JSON array of StreamFrames, got ${parsed === null ? "null" : typeof parsed}`,
    );
  }

  const result = replayFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `replay file ${resolved} is not a valid StreamFrame array: ${summarizeIssues(result.error)}`,
    );
  }

  return result.data;
}

export default loadReplay;
