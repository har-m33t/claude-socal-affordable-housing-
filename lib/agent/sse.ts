/**
 * Lane `agent-loop`: StreamFrame -> server-sent events.
 *
 * One frame is one SSE message: `data: <json>\n\n`. No event names, no ids, no
 * comments - the browser side is a plain EventSource/fetch reader that does
 * JSON.parse on every `data:` line.
 */
import type { StreamFrame } from "./types";

export const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  // nginx and friends buffer text/event-stream by default; this turns it off.
  "X-Accel-Buffering": "no",
};

/**
 * SSE event name for a frame, or null for an action frame.
 *
 * Control frames carry `event: <type>` so a harness can route them without
 * parsing the payload; action frames deliberately carry no name, so a default
 * `message` listener sees agent actions and nothing else. A consumer that
 * parses `data` is unaffected either way, since the JSON is identical.
 */
export function frameEventName(frame: StreamFrame): string | null {
  return frame.type === "event" ? null : frame.type;
}

/**
 * One SSE message. `data: {json}\n\n` for an action frame, and
 * `event: <type>\ndata: {json}\n\n` for a control frame.
 *
 * JSON.stringify never emits a raw newline, so the payload is always one line
 * and never needs multi-line `data:` continuation.
 */
export function formatFrame(frame: StreamFrame): string {
  const name = frameEventName(frame);
  const payload = `data: ${JSON.stringify(frame)}\n\n`;
  return name === null ? payload : `event: ${name}\n${payload}`;
}

/** Errors leaving the loop become this frame. Carries no request content. */
function errorFrame(err: unknown): StreamFrame {
  const code =
    typeof err === "object" && err !== null && "status" in err
      ? `api_${String((err as { status?: unknown }).status ?? "error")}`
      : "stream_error";
  return {
    type: "error",
    code,
    // Deliberately generic: an error message must never carry applicant text.
    message: "The agent run failed before it finished. Nothing was submitted anywhere.",
  };
}

/**
 * Turn an async iterable of frames into a byte stream of SSE messages.
 * If the iterable throws, one `error` frame is emitted and the stream closes
 * cleanly, so the browser sees a terminal frame instead of a dangling socket.
 */
export function toSSEStream(frames: AsyncIterable<StreamFrame>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let iterator: AsyncIterator<StreamFrame> | null = null;

  return new ReadableStream<Uint8Array>({
    start() {
      iterator = frames[Symbol.asyncIterator]();
    },
    async pull(controller) {
      if (iterator === null) {
        controller.close();
        return;
      }
      try {
        const next = await iterator.next();
        if (next.done === true) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(formatFrame(next.value)));
      } catch (err) {
        controller.enqueue(encoder.encode(formatFrame(errorFrame(err))));
        controller.close();
      }
    },
    async cancel(reason) {
      // The UI's stop button closes the socket; let the loop unwind.
      await iterator?.return?.(reason);
    },
  });
}

/** A ready-to-return Response for the route. */
export function sseResponse(frames: AsyncIterable<StreamFrame>, status = 200): Response {
  return new Response(toSSEStream(frames), { status, headers: SSE_HEADERS });
}
