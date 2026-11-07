// @vitest-environment jsdom
/**
 * Lane `live-run`: the real agent run, driven from the UI.
 *
 * Every test stubs `fetch`. No test makes a network call and no test needs an
 * API key: the point of this suite is that the browser side behaves correctly
 * against a stubbed stream, including the no-key path a reviewer will actually
 * hit.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CityConfig } from "@/components/pointer/contract";
import {
  drainSSE,
  errorFromResponse,
  useLiveRun,
  type LiveError,
} from "@/components/pointer/use-live-run";
import { ActionLog } from "@/components/editor/ActionLog";
import { RunNotice } from "@/components/editor/RunNotice";
import { rowsFromFrames } from "@/components/editor/log-rows";
import { DEFAULT_QUESTION } from "@/components/editor/QuestionBar";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const CITY: CityConfig = {
  city: "Anaheim",
  verified: true,
  checked_date: "2025-11-01",
  checklist_pdf: "/data/docs/anaheim.pdf",
  sources: ["https://example.gov/checklist"],
  fast_paths: [],
  checklist: [
    { id: "site-plan", text: "Site plan", page: 1, box: [0, 0, 10, 10], doc_type: "plan", source: "https://example.gov/checklist" },
    { id: "sewer", text: "Sewer capacity", page: 1, box: [0, 20, 10, 10], doc_type: "letter", source: "https://example.gov/checklist" },
  ],
};

const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
/** Control frames carry an `event:` name line as well as `data:`. */
const named = (o: { type: string; [key: string]: unknown }) => `event: ${o.type}\n${frame(o)}`;

function streamOf(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: false,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

// ---------------------------------------------------------------- harness

function Harness({ onScripted = () => {} }: { onScripted?: () => void }) {
  const live = useLiveRun({ city: CITY, cityName: CITY.city, projectType: "adu", question: "What is missing?" });
  return (
    <div>
      <button type="button" onClick={live.start}>
        run
      </button>
      <button type="button" onClick={live.stop}>
        stop
      </button>
      <output data-testid="phase">{live.phase}</output>
      <output data-testid="applied">{live.state.log.length}</output>
      <output data-testid="pointed">{live.state.pointedItem ?? "-"}</output>
      <output data-testid="sewer-status">{live.state.items.sewer?.status ?? "-"}</output>
      <output data-testid="site-plan-suggestions">{live.state.items["site-plan"]?.suggestions.length ?? 0}</output>
      {live.error && <RunNotice error={live.error} onScripted={onScripted} />}
      <ActionLog rows={rowsFromFrames(live.frames)} checklist={CITY.checklist} running={false} />
    </div>
  );
}

async function runWith(chunks: string[]): Promise<void> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => streamOf(chunks)),
  );
  render(<Harness />);
  fireEvent.click(screen.getByText("run"));
  await screen.findByText("done");
}

// ---------------------------------------------------------------- SSE parsing

describe("drainSSE", () => {
  it("keeps a frame that is split across chunk boundaries until it is whole", () => {
    const whole = frame({ type: "status", phase: "started" });
    const a = whole.slice(0, 18);
    const b = whole.slice(18);

    const first = drainSSE(a);
    expect(first.frames).toEqual([]);
    expect(first.rest).toBe(a);

    const second = drainSSE(first.rest + b);
    expect(second.frames).toEqual([{ type: "status", phase: "started" }]);
    expect(second.rest).toBe("");
  });

  it("parses several frames out of one chunk and leaves a partial tail behind", () => {
    const text = frame({ type: "refusal", reason: "out of scope" }) + frame({ type: "error", code: "x", message: "y" }) + 'data: {"type":"sta';
    const out = drainSSE(text);
    expect(out.frames).toHaveLength(2);
    expect(out.rest).toBe('data: {"type":"sta');
  });

  it("reads the data line of a named control frame and ignores the name", () => {
    const out = drainSSE(named({ type: "dropped" }));
    expect(out.frames).toEqual([{ type: "dropped" }]);
  });

  it("turns a malformed data line into an error frame instead of throwing", () => {
    const out = drainSSE("data: {not json}\n\n");
    expect(out.frames).toEqual([{ type: "error", code: "bad_frame", message: "A streamed frame was not valid JSON." }]);
  });

  it("accepts CRLF line endings", () => {
    const out = drainSSE(`event: status\r\ndata: {"type":"status","phase":"done"}\r\n\r\n`);
    expect(out.frames).toEqual([{ type: "status", phase: "done" }]);
  });
});

// ---------------------------------------------------------------- error mapping

describe("errorFromResponse", () => {
  it("reads 503 no_api_key as a configuration fact, not a crash", () => {
    const e = errorFromResponse(503, { error: "no_api_key" });
    expect(e.kind).toBe("no_api_key");
    expect(e.message).toContain("ANTHROPIC_API_KEY");
    expect(e.message).toContain("scripted");
  });

  it("reads 429 rate_limited with the wait in seconds", () => {
    const e = errorFromResponse(429, { error: "rate_limited", retry_after_ms: 4200 });
    expect(e.kind).toBe("rate_limited");
    expect(e).toMatchObject({ global: false });
    expect(e.message).toContain("5s");
  });

  it("distinguishes the global ceiling from this caller's", () => {
    const e = errorFromResponse(429, { error: "rate_limited_global", retry_after_ms: 1000 });
    expect(e).toMatchObject({ kind: "rate_limited", global: true });
    expect(e.message).toContain("all callers");
  });

  it("reads 400 invalid_request field problems", () => {
    const e = errorFromResponse(400, {
      error: "invalid_request",
      issues: [{ path: "question", message: "Too small: expected string to have >=1 characters" }],
    });
    expect(e.kind).toBe("invalid_request");
    expect(e.kind === "invalid_request" && e.issues).toEqual([
      { path: "question", message: "Too small: expected string to have >=1 characters" },
    ]);
  });

  it("falls back to an honest http message for anything else", () => {
    const e = errorFromResponse(500, {});
    expect(e).toMatchObject({ kind: "stream", code: "http_500" });
    expect(e.message).toContain("500");
  });

  it("gives every error kind its own heading in the banner", () => {
    const kinds: LiveError[] = [
      { kind: "no_api_key", message: "a" },
      { kind: "rate_limited", message: "b", global: false },
      { kind: "invalid_request", message: "c", issues: [] },
      { kind: "refusal", message: "d" },
      { kind: "stream", message: "e", code: "f" },
      { kind: "network", message: "g" },
    ];
    const headings = new Set<string>();
    for (const error of kinds) {
      const view = render(<RunNotice error={error} onScripted={() => {}} />);
      headings.add(view.container.querySelector("p")?.textContent ?? "");
      view.unmount();
    }
    expect(headings.size).toBe(kinds.length);
  });
});

// ---------------------------------------------------------------- live run

describe("useLiveRun", () => {
  it("POSTs the contract body to /api/agent", async () => {
    const fetchMock = vi.fn(async () => streamOf([frame({ type: "status", phase: "done" })]));
    vi.stubGlobal("fetch", fetchMock);
    render(<Harness />);
    fireEvent.click(screen.getByText("run"));
    await screen.findByText("done");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/agent");
    expect(init.method).toBe("POST");
    // `projectType`, not `type`, and no extra keys: the route's schema is strict.
    expect(JSON.parse(String(init.body))).toEqual({ city: "Anaheim", projectType: "adu", question: "What is missing?" });
  });

  it("feeds streamed events through applyEvent, including a frame split mid-JSON", async () => {
    const point = frame({ type: "event", event: { tool: "point_to", item_id: "sewer", ts: "2026-11-07T21:00:01Z" } });
    const mark = frame({
      type: "event",
      event: { tool: "mark_item", item_id: "sewer", status: "missing", text: "No sewer letter in the packet.", ts: "2026-11-07T21:00:04Z" },
    });
    const draft = frame({
      type: "event",
      event: { tool: "draft_field", item_id: "site-plan", text: "Add north arrow and scale.", ts: "2026-11-07T21:00:07Z" },
    });
    // The split lands inside the mark_item JSON.
    const cut = 30;
    await runWith([
      named({ type: "status", phase: "started" }),
      point + mark.slice(0, cut),
      mark.slice(cut) + draft,
      named({ type: "status", phase: "done" }),
    ]);

    expect(screen.getByTestId("applied").textContent).toBe("3");
    expect(screen.getByTestId("sewer-status").textContent).toBe("missing");
    // draft_field does not move the hand; point_to and highlight do.
    expect(screen.getByTestId("pointed").textContent).toBe("sewer");
    expect(screen.getByTestId("site-plan-suggestions").textContent).toBe("1");
    // The reducer's own log, i.e. the real RunState, carries the action.
    expect(screen.getByText("No sewer letter in the packet.")).toBeTruthy();
  });

  it("logs an event for an item id the city file does not have, and ignores it", async () => {
    await runWith([
      frame({ type: "event", event: { tool: "mark_item", item_id: "not-a-real-item", status: "complete", ts: "2026-11-07T21:00:01Z" } }),
      frame({ type: "status", phase: "done" }),
    ]);
    expect(screen.getByText(/Ignored: unknown item_id/)).toBeTruthy();
  });

  it("shows dropped, status, refusal and error frames distinctly", async () => {
    await runWith([
      named({ type: "status", phase: "step", step: 2 }),
      named({
        type: "dropped",
        reason: "text asserts law with no statute_id",
        event: { tool: "add_note", item_id: "sewer", ts: "2026-11-07T21:00:02Z" },
      }),
      named({ type: "refusal", reason: "that is a legal question" }),
      named({ type: "error", code: "api_529", message: "The agent run failed before it finished." }),
      named({ type: "status", phase: "done" }),
    ]);

    expect(screen.getByText(/Law gate refused this action:/)).toBeTruthy();
    expect(screen.getByText(/text asserts law with no statute_id/)).toBeTruthy();
    expect(screen.getByText("thinking")).toBeTruthy();
    expect(screen.getByText("step 2")).toBeTruthy();
    expect(screen.getByText(/The agent refused:/)).toBeTruthy();
    expect(screen.getByText("api_529")).toBeTruthy();
  });

  it("renders a server-rendered statute_ref as a source chip", async () => {
    await runWith([
      frame({
        type: "event",
        event: {
          tool: "highlight",
          item_id: "sewer",
          text: "Law Lens: this step changed.",
          ts: "2026-11-07T21:00:01Z",
          statute_ref: {
            id: "ab2533",
            old: "65852.2",
            new_range: "66310-66342",
            title: "AB 2533",
            source_url: "https://leginfo.legislature.ca.gov/x",
            checked_date: "2025-11-01",
          },
        },
      }),
      frame({ type: "status", phase: "done" }),
    ]);
    const chip = screen.getByRole("link", { name: /AB 2533/ });
    expect(chip.getAttribute("href")).toBe("https://leginfo.legislature.ca.gov/x");
  });

  it("explains a 503 with no API key and offers the scripted run in one click", async () => {
    const onScripted = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(503, { error: "no_api_key", message: "server text" })),
    );
    render(<Harness onScripted={onScripted} />);
    fireEvent.click(screen.getByText("run"));

    await screen.findByText("No API key on this server, so no live run");
    expect(screen.getByText(/ANTHROPIC_API_KEY/)).toBeTruthy();
    expect(screen.getByTestId("phase").textContent).toBe("error");
    fireEvent.click(screen.getByText("Run the scripted demo instead"));
    expect(onScripted).toHaveBeenCalledTimes(1);
  });

  it("shows the wait on a 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(429, { error: "rate_limited", retry_after_ms: 9000 })),
    );
    render(<Harness />);
    fireEvent.click(screen.getByText("run"));
    await screen.findByText("Live runs are rate limited right now");
    expect(screen.getByText(/about 9s/)).toBeTruthy();
  });

  it("shows the field problems on a 400", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(400, { error: "invalid_request", issues: [{ path: "question", message: "Too small" }] })),
    );
    render(<Harness />);
    fireEvent.click(screen.getByText("run"));
    await screen.findByText("The run request was rejected");
    expect(screen.getByText("question: Too small")).toBeTruthy();
  });

  it("stop() aborts the fetch itself, not just the rendering", async () => {
    let signal: AbortSignal | undefined;
    const encoder = new TextEncoder();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        signal = init.signal ?? undefined;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(frame({ type: "status", phase: "started" })));
            // What the browser does to an in-flight body when the signal fires.
            init.signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")));
          },
        });
        return { ok: true, status: 200, body } as unknown as Response;
      }),
    );

    render(<Harness />);
    fireEvent.click(screen.getByText("run"));
    await screen.findByText("running");
    expect(signal?.aborted).toBe(false);

    fireEvent.click(screen.getByText("stop"));
    await screen.findByText("stopped");
    expect(signal?.aborted).toBe(true);
    // An abort is the person's choice, so it is not reported as an error.
    expect(screen.queryByText(/Could not reach the agent endpoint/)).toBeNull();
  });

  it("reports a network failure honestly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    render(<Harness />);
    fireEvent.click(screen.getByText("run"));
    await screen.findByText("Could not start the run");
    expect(screen.getByText(/Failed to fetch/)).toBeTruthy();
  });

  it("finishes a stream that ends without a trailing blank line or a done status", async () => {
    await runWith([`data: ${JSON.stringify({ type: "event", event: { tool: "point_to", item_id: "sewer", ts: "2026-11-07T21:00:01Z" } })}`]);
    expect(screen.getByTestId("applied").textContent).toBe("1");
    expect(screen.getByTestId("phase").textContent).toBe("done");
  });
});

// ---------------------------------------------------------------- the editor

// The checklist viewer is another lane's component and pulls in pdf.js, which
// has no business in this suite. The run driver is what is under test.
vi.mock("@/components/pdf/ChecklistViewer", () => ({
  default: () => <div data-testid="checklist-viewer" />,
}));

describe("Editor", () => {
  it("offers a question field with a default, a live run and the scripted fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(503, { error: "no_api_key" })),
    );
    const { Editor } = await import("@/components/editor/Editor");
    render(<Editor />);

    const field = screen.getByLabelText(/Your question/) as HTMLInputElement;
    expect(field.value).toBe(DEFAULT_QUESTION);
    expect(screen.getByLabelText(/Live agent run/)).toBeTruthy();
    expect(screen.getByLabelText(/Scripted replay/)).toBeTruthy();

    fireEvent.change(field, { target: { value: "Do I need a sewer letter?" } });
    fireEvent.click(screen.getByText("Run live agent"));

    // No key on this server: say so, and hand over the recorded run.
    await screen.findByText("No API key on this server, so no live run");
    fireEvent.click(screen.getByText("Run the scripted demo instead"));
    expect(screen.getByText(/scripted replay of a recorded run/)).toBeTruthy();
    expect(screen.getByText(/scripted ·/)).toBeTruthy();
  });
});
