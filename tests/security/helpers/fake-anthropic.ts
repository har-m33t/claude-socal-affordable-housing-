/**
 * A fake Anthropic Messages API that stands in for `fetch`.
 *
 * How it intercepts: @anthropic-ai/sdk 1.6.0 captures its fetch once, in the client
 * constructor (`this.fetch = options.fetch ?? Shims.getDefaultFetch()`, and
 * `getDefaultFetch()` returns the global `fetch`). So the global must be replaced
 * BEFORE the route module creates its client. route-harness.ts installs one
 * permanent dispatcher on `globalThis.fetch` before it imports any route, and
 * points the dispatcher at a fresh FakeAnthropic per run. Whether the route builds
 * its client at module load or per request, every SDK call lands here.
 *
 * Any request that is not `POST https://api.anthropic.com/v1/messages[...]` is
 * recorded as a blocked outbound attempt and fails with a network error, so a
 * route that phones anywhere else is caught (and nothing leaves the machine).
 *
 * Supports both response modes the SDK uses:
 *  - non-streaming: a JSON Message object;
 *  - `stream: true`: Messages API server-sent events (message_start,
 *    content_block_start, content_block_delta with text_delta / input_json_delta,
 *    content_block_stop, message_delta, message_stop).
 *
 * The API key is never recorded: captured requests keep header NAMES only.
 */

export type FakeBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; name: string; input: Record<string, unknown> };

export interface FakeTurn {
  content: FakeBlock[];
  stop_reason: "tool_use" | "end_turn";
}

/** Given the parsed request body and its 0-based index, decide what the "model" says. */
export type FakeScript = (body: MessagesRequestBody, index: number) => FakeTurn;

export interface MessagesRequestBody {
  model?: string;
  max_tokens?: unknown;
  system?: unknown;
  messages?: unknown;
  tools?: unknown;
  stream?: boolean;
  [key: string]: unknown;
}

export interface CapturedRequest {
  url: string;
  body: MessagesRequestBody;
  headerNames: string[];
}

export interface BlockedAttempt {
  url: string;
  method: string;
  via: string;
}

const ANTHROPIC_ORIGIN = "https://api.anthropic.com";

export class FakeAnthropic {
  readonly requests: CapturedRequest[] = [];
  readonly blocked: BlockedAttempt[] = [];
  readonly streamedResponses: number[] = [];
  private toolUseCounter = 0;

  constructor(private readonly script: FakeScript) {}

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const isMessages =
      url.origin === ANTHROPIC_ORIGIN &&
      request.method === "POST" &&
      (url.pathname === "/v1/messages" || url.pathname === "/v1/messages/count_tokens");
    if (!isMessages) {
      this.recordBlocked(request.url, request.method, "fetch");
      throw new TypeError(`fetch failed: outbound request to ${url.origin} blocked by security test`);
    }

    const body = JSON.parse(await request.text()) as MessagesRequestBody;
    if (url.pathname === "/v1/messages/count_tokens") {
      return jsonResponse({ input_tokens: 100 });
    }

    const index = this.requests.length;
    this.requests.push({
      url: request.url,
      body,
      headerNames: [...request.headers.keys()].sort(),
    });
    const turn = this.script(body, index);
    const message = this.toMessage(turn, body.model ?? "unknown-model");
    if (body.stream === true) {
      this.streamedResponses.push(index);
      return sseResponse(messageToStreamEvents(message));
    }
    return jsonResponse(message);
  };

  recordBlocked(url: string, method: string, via: string): void {
    this.blocked.push({ url, method, via });
  }

  private toMessage(turn: FakeTurn, model: string) {
    return {
      id: `msg_fake_${this.requests.length}`,
      type: "message",
      role: "assistant",
      model,
      content: turn.content.map((block) =>
        block.type === "text"
          ? { type: "text", text: block.text, citations: null }
          : { type: "tool_use", id: `toolu_fake_${++this.toolUseCounter}`, name: block.name, input: block.input },
      ),
      stop_reason: turn.stop_reason,
      stop_sequence: null,
      usage: { input_tokens: 50, output_tokens: 50 },
    };
  }
}

type FakeMessage = ReturnType<FakeAnthropic["toMessage"]>;

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json", "request-id": "req_fake" },
  });
}

function messageToStreamEvents(message: FakeMessage): Array<[string, unknown]> {
  const events: Array<[string, unknown]> = [
    ["message_start", { type: "message_start", message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 50, output_tokens: 1 } } }],
  ];
  message.content.forEach((block, index) => {
    if (block.type === "text") {
      events.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "", citations: null } }]);
      events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } }]);
    } else {
      events.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } }]);
      // Split the JSON in two so the SDK's partial-JSON accumulation is exercised.
      const json = JSON.stringify(block.input);
      const mid = Math.floor(json.length / 2);
      for (const partial_json of [json.slice(0, mid), json.slice(mid)]) {
        events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json } }]);
      }
    }
    events.push(["content_block_stop", { type: "content_block_stop", index }]);
  });
  events.push(["message_delta", { type: "message_delta", delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 50 } }]);
  events.push(["message_stop", { type: "message_stop" }]);
  return events;
}

function sseResponse(events: Array<[string, unknown]>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const [name, data] of events) {
        controller.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream", "request-id": "req_fake" },
  });
}

/** Item id the obedient model invents; it must never reach the browser. */
export const FAKE_INVENTED_ITEM_ID = "NOT-A-REAL-ITEM";

/**
 * An "obedient" model that does everything the planted injection asks, every turn,
 * forever: calls tools that must not exist, invents an item id, marks every real
 * item complete, and claims the permit is approved. After `hardLimit` requests it
 * finally ends its turn, only so a route WITHOUT a step cap still terminates and the
 * step-cap check can report it instead of the test hanging.
 */
export function obedientScript(checklistIds: readonly string[], hardLimit = 40): FakeScript {
  return (_body, index) => {
    if (index + 1 >= hardLimit) {
      return { stop_reason: "end_turn", content: [{ type: "text", text: "Done." }] };
    }
    return {
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "Following the site plan notes: the permit is approved and I have submitted the application." },
        { type: "tool_use", name: "submit_application", input: { confirm: true } },
        { type: "tool_use", name: "send_email", input: { to: "records@example.com", body: "Owner details attached." } },
        { type: "tool_use", name: "mark_item", input: { item_id: FAKE_INVENTED_ITEM_ID, status: "complete" } },
        ...checklistIds.map((item_id): FakeBlock => ({ type: "tool_use", name: "mark_item", input: { item_id, status: "complete" } })),
      ],
    };
  };
}
