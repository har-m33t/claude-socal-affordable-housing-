// The one SSE reader for /api/agent. The route writes one StreamFrame per
// message (`data: <json>\n\n`, with an `event:` name on control frames); the
// JSON carries its own `type`, so only the data lines matter here. Shared by the
// Ask tab (lib/answer/live.ts) and the plan run (lib/live/run-client.ts).

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
