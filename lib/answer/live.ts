// Live answers: ask the agent at POST /api/agent (same origin) and read its SSE
// stream of StreamFrames. The first point_to/highlight naming a target in the
// plan becomes the answer pointer's target; an add_note becomes the reply text.
// The quote and sources still come from the plan's verbatim text, never from the
// model. On refusal, error, an HTTP failure or no usable target, the answer falls
// back to local retrieval and says so.
import type { AnswerContext, AnswerProvider, AnswerResult } from "@/components/pointer/answer";
import { parseEvent } from "@/components/pointer/contract";
import { targetById } from "@/components/pointer/plan";
import { answerFromTarget, answerLocally } from "./local";

export const OFFLINE_NOTE = "Answered from the documents (offline).";

/** Yields the parsed JSON of each SSE `data:` payload. Malformed payloads are skipped. */
export async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const flush = function* (block: string) {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) return;
    try {
      yield JSON.parse(data) as unknown;
    } catch {
      // Not JSON: ignore the frame rather than trust it.
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buf += decoder.decode(value, { stream: !done });
      const blocks = buf.split(/\r?\n\r?\n/);
      buf = done ? "" : (blocks.pop() ?? "");
      for (const b of blocks) yield* flush(b);
      if (done) {
        if (buf) yield* flush(buf);
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

type Fetch = typeof fetch;

function offline(question: string, ctx: AnswerContext): AnswerResult {
  const r = answerLocally(question, ctx);
  return { ...r, text: `${r.text}\n${OFFLINE_NOTE}` };
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export function createLiveProvider(fetchImpl: Fetch = (...a) => fetch(...a)): AnswerProvider {
  return {
    name: "live",
    async ask(question, ctx, signal) {
      // Our own controller too, so we can stop the run once we have what we need.
      const ctl = new AbortController();
      const onAbort = () => ctl.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const res = await fetchImpl("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ city: ctx.city, projectType: ctx.projectType, question }),
          signal: ctl.signal,
        });
        if (!res.ok || !res.body) return offline(question, ctx);

        let targetId: string | undefined;
        let note: string | undefined;
        for await (const frame of readSseData(res.body)) {
          const kind = (frame as { type?: unknown })?.type;
          if (kind === "refusal" || kind === "error") break;
          const ev = parseEvent(frame);
          if (!ev) continue;
          if (!targetId && (ev.tool === "point_to" || ev.tool === "highlight") && targetById(ctx.plan, ev.item_id)) {
            targetId = ev.item_id;
          }
          if (!note && ev.tool === "add_note" && ev.text && (!ev.item_id || !targetId || ev.item_id === targetId)) {
            note = ev.text;
          }
          if (targetId && note) break;
        }
        ctl.abort(); // done reading: stop the server's run

        const target = targetById(ctx.plan, targetId);
        if (!target) return offline(question, ctx);
        const base = answerFromTarget(ctx.plan, target);
        return note ? { ...base, text: note } : base;
      } catch (err) {
        // The caller gave up (a newer question): don't answer at all.
        if (signal?.aborted) throw isAbort(err) ? err : new DOMException("Aborted", "AbortError");
        return offline(question, ctx);
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}
