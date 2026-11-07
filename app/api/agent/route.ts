/**
 * POST /api/agent - run the agent and stream StreamFrames as SSE.
 *
 * There is no GET handler, and there is no endpoint anywhere in this app that
 * submits, files, emails, faxes or posts anything to a city, a portal or any
 * third party. Do not add one.
 *
 * The request body can contain text an applicant typed. It is never logged,
 * never echoed back in full, and never written to disk by this file.
 *
 * `record` is NOT a body field. Recording overwrites fixtures/replay.json -
 * the demo's fallback when the API or the wifi fails - so whether a run is
 * recorded is an operator decision (POINTER_ALLOW_RECORD, see config.ts), not
 * something a caller asks for. The schema below is strict, so a body carrying
 * `record` is rejected as an unknown key rather than quietly ignored.
 *
 * There is no authentication and no Origin/CSRF check here on purpose: this is
 * a localhost prototype, and deploying it further is gated on HTTPS, CORS
 * locked to this app's origin and a privacy notice, per the build plan.
 */
import { z } from "zod";

// Relative, not the "@/" alias: this handler is unit-tested directly and the
// test runner does not resolve tsconfig paths.
import { hasApiKey, recordingEnabled } from "../../../lib/agent/config";
import { runAgent } from "../../../lib/agent/loop";
import { clientKey, rateLimitOptions, requestRateLimiter } from "../../../lib/agent/ratelimit";
import { checkDurableLimit } from "../../../lib/agent/durable-limit";
import { sseResponse } from "../../../lib/agent/sse";
import type { AgentRunInput } from "../../../lib/agent/loop";

// SSE must never be statically optimized, prerendered or cached.
export const dynamic = "force-dynamic";
// The loop reads data/ and fixtures/ from disk.
export const runtime = "nodejs";

/**
 * One attached document. `text` is already redacted in the browser by Team 4's
 * lib/redact before it is sent; this lane treats it as untrusted regardless,
 * and it only ever reaches the model inside the untrusted envelope in a user
 * turn, with `<` escaped.
 */
/**
 * Aggregate cap across ALL documents in one run. The per-document limit alone
 * allowed 20 x 200,000 = 4,000,000 characters to be shipped to the model, and
 * the rate limiter counts requests rather than bytes, so one allowed request
 * could cost far more than the step and token caps suggest.
 */
const TOTAL_DOCUMENT_CHARS = 100_000;

const DocumentSchema = z.strictObject({
  name: z.string().min(1).max(260),
  declared_type: z.string().min(1).max(120),
  text: z.string().max(200_000),
});

const BodySchema = z.strictObject({
  city: z.string().min(1).max(120),
  // `projectType`, not `type`: `type` collides with the StreamFrame
  // discriminator and would be ambiguous on the wire.
  projectType: z.string().min(1).max(120),
  question: z.string().min(1).max(4_000),
  documents: z
    .array(DocumentSchema)
    .max(20)
    .refine(
      (docs) => docs.reduce((n, d) => n + d.text.length, 0) <= TOTAL_DOCUMENT_CHARS,
      { message: `documents exceed the combined ${TOTAL_DOCUMENT_CHARS} character budget for one run` },
    )
    .optional(),
  replay: z.boolean().optional(),
  // No `record` field. See the header comment: it is server-side only.
  // No `packet` field either: superseded by `documents` (issue #3). Both it
  // and `type` are now rejected as unknown keys rather than ignored.
});

/** zod issues are reduced to path + message so no submitted value is echoed. */
function issueSummary(err: z.ZodError): Array<{ path: string; message: string }> {
  return err.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    // No logging: the unparsed body may contain applicant text.
    return json({ error: "invalid_json", message: "The request body is not valid JSON." }, 400);
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return json(
      {
        error: "invalid_request",
        message: "The request body does not match the agent run contract.",
        issues: issueSummary(parsed.error),
      },
      400,
    );
  }

  const live = parsed.data.replay !== true;

  if (live && !hasApiKey()) {
    return json(
      {
        error: "no_api_key",
        message:
          "ANTHROPIC_API_KEY is not set on the server, so a live run is not possible. " +
          "Send { replay: true } to stream a recorded run instead.",
      },
      503,
    );
  }

  // Only live runs spend tokens, so only live runs are rate limited. Two caps
  // are checked: the whole app's ceiling first, then this client's own.
  if (live) {
    const who = clientKey(request.headers);
    // Durable first: in-process counters are per serverless instance, so on
    // Vercel the global cap is only real when it lives in Redis. A null means
    // the backend is absent or unhealthy, and we fall back to the in-process
    // limiter rather than either failing the run or removing the ceiling.
    const durable = await checkDurableLimit(who, rateLimitOptions());
    const decision = durable ?? requestRateLimiter().check(who);
    if (!decision.ok) {
      const seconds = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
      const atGlobalCeiling = decision.scope === "global";
      return new Response(
        JSON.stringify({
          error: atGlobalCeiling ? "rate_limited_global" : "rate_limited",
          message: atGlobalCeiling
            ? `This app is at its ceiling for live agent runs across all callers. Try again in about ${seconds}s, or send { replay: true } for a recorded run.`
            : `Too many live agent runs. Try again in about ${seconds}s, or send { replay: true } for a recorded run.`,
          retry_after_ms: decision.retryAfterMs,
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "Retry-After": String(seconds),
          },
        },
      );
    }
  }

  const body: AgentRunInput = {
    ...parsed.data,
    // Server-side only. A caller cannot ask for this.
    record: recordingEnabled(),
  };

  // request.signal fires when the browser's stop button aborts the fetch.
  return sseResponse(runAgent(body, { signal: request.signal }));
}
