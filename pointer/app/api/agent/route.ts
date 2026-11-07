/**
 * POST /api/agent - run the agent and stream StreamFrames as SSE.
 *
 * There is no GET handler, and there is no endpoint anywhere in this app that
 * submits, files, emails, faxes or posts anything to a city, a portal or any
 * third party. Do not add one.
 *
 * The request body can contain text an applicant typed. It is never logged,
 * never echoed back in full, and never written to disk by this file.
 */
import { z } from "zod";

import { hasApiKey } from "@/lib/agent/config";
import { runAgent } from "@/lib/agent/loop";
import { sseResponse } from "@/lib/agent/sse";
import type { AgentRunRequest } from "@/lib/agent/types";

// SSE must never be statically optimized, prerendered or cached.
export const dynamic = "force-dynamic";
// The loop reads data/ and fixtures/ from disk.
export const runtime = "nodejs";

const PacketFileSchema = z.strictObject({
  name: z.string().min(1).max(260),
  declared_type: z.string().min(1).max(120),
  pages: z.number().int().positive().max(10_000).optional(),
});

/**
 * `synthetic: true` is required by contract: the only applicant this prototype
 * accepts is a made-up one.
 */
const PacketSchema = z.strictObject({
  applicant: z.string().min(1).max(400),
  synthetic: z.literal(true),
  scenario: z.string().max(2_000).optional(),
  files: z.array(PacketFileSchema).max(50),
});

const BodySchema = z.strictObject({
  city: z.string().min(1).max(120),
  projectType: z.string().min(1).max(120),
  question: z.string().min(1).max(4_000),
  packet: PacketSchema.optional(),
  replay: z.boolean().optional(),
  record: z.boolean().optional(),
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

  const body: AgentRunRequest = parsed.data;

  if (body.replay !== true && !hasApiKey()) {
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

  // request.signal fires when the browser's stop button aborts the fetch.
  return sseResponse(runAgent(body, { signal: request.signal }));
}
