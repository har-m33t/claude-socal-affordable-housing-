/**
 * End to end, with the fake Anthropic Messages API: the browser-side packet
 * builder reads and redacts the real made-up PDFs, startLiveRun POSTs them to the
 * real route, the real loop/validator/verifier run a multi-turn tool sequence
 * over plan targets, and the editor's reducer ends in the expected state.
 */
import { readFileSync } from "node:fs";
import * as nodePath from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../app/api/agent/route";
import { PACKET_FILES, PLAN } from "../../components/pointer/config";
import { idleSession, runReducer, type RunSession } from "../../components/pointer/run-session";
import { preparePacketRun } from "../../lib/live/packet";
import { startLiveRun, type LiveRunSignal } from "../../lib/live/run-client";
import { FakeAnthropic, type FakeBlock, type FakeScript } from "../security/helpers/fake-anthropic";
import { extractPdfText } from "../security/helpers/pdf-text";

const APP_ROOT = process.cwd();
const applicant = JSON.parse(readFileSync(nodePath.join(APP_ROOT, "data/packet/applicant.json"), "utf8")) as {
  name: string;
  co_owner: string;
};

const call = (name: string, input: Record<string, unknown>): FakeBlock => ({ type: "tool_use", name, input });
const point = (item_id: string) => call("point_to", { item_id });
const mark = (item_id: string, status: string) => call("mark_item", { item_id, status, statute_id: null });
const draft = (item_id: string, text: string) => call("draft_field", { item_id, text, statute_id: null });
const note = (item_id: string, text: string) => call("add_note", { item_id, text, statute_id: null });

/** A model that walks part of the plan in batched turns, as the prompt asks. */
const TURNS: FakeBlock[][] = [
  [point("z412-overview"), point("adu-express-program"), mark("adu-express-program", "unknown")],
  [
    point("express-project-address"),
    draft("express-project-address", "[ADDRESS_1]"),
    point("express-applicant-name"),
    draft("express-applicant-name", "[NAME_1]"),
    point("express-adu-address"),
    mark("express-adu-address", "unknown"),
  ],
  [
    point("sewer-capacity-verification"),
    mark("sewer-capacity-verification", "complete"),
    point("meter-spot-report"),
    mark("meter-spot-report", "missing"),
    note("meter-spot-report", "No meter spot report attached"),
    point("new-address-request"),
    mark("new-address-request", "missing"),
  ],
  // Law in prose is dropped by the verifier; an invented id by the validator.
  [point("b802-adu-impact-fees"), note("b802-adu-impact-fees", "Exempt under Government Code Section 66324."), point("NOT-A-REAL-ITEM")],
];
const script: FakeScript = (_body, i) =>
  i < TURNS.length ? { stop_reason: "tool_use", content: TURNS[i] } : { stop_reason: "end_turn", content: [{ type: "text", text: "" }] };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("live plan run, end to end against the fake Anthropic API", () => {
  it("drives statuses, drafts and drops through the editor reducer", async () => {
    const prepared = await preparePacketRun({
      city: "Anaheim",
      projectType: "adu",
      packet: PACKET_FILES,
      added: [],
      applicant,
      extract: async (buf) => ({ text: await extractPdfText(new Uint8Array(buf)) }),
      fetchImpl: (async (url: string) =>
        new Response(readFileSync(nodePath.join(APP_ROOT, "public", decodeURIComponent(url))))) as unknown as typeof fetch,
    });
    // Nothing personal leaves the browser.
    const wire = JSON.stringify(prepared.request);
    for (const secret of ["Maria", "Daniel", "Placeholder Lane", "000-000-00", "714-555-0142", "maria.ejemplo"]) {
      expect(wire).not.toContain(secret);
    }
    expect(prepared.request.documents.map((d) => d.declared_type)).toEqual(PACKET_FILES.map((f) => f.declared_type));

    const fake = new FakeAnthropic(script);
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-fake-key-for-tests");
    vi.stubGlobal("fetch", fake.fetch);

    const signals: LiveRunSignal[] = [];
    const end = await startLiveRun(prepared.request, (s) => signals.push(s), undefined, (async (_url: string, init: RequestInit) =>
      POST(new Request("http://localhost/api/agent", init))) as unknown as typeof fetch);

    expect(end).toEqual({ kind: "done" });
    expect(fake.blocked).toEqual([]);
    expect(fake.requests).toHaveLength(TURNS.length + 1);
    const first = JSON.stringify(fake.requests[0].body);
    expect(first).toContain("PLAN: Anaheim / adu");
    expect(first).toContain("[NAME_1]");
    expect(first).not.toContain("Maria");

    // Fold exactly as the editor does: queue, then drain.
    const scope = { checklist: PLAN.targets };
    let s: RunSession = runReducer(idleSession(), { type: "begin", play: "playing" });
    for (const sig of signals) {
      if (sig.kind === "status") continue;
      const event = sig.event.text === undefined ? sig.event : { ...sig.event, text: prepared.restore!(sig.event.text) };
      s = runReducer(s, { type: "push", item: sig.kind === "event" ? { kind: "event", event } : { kind: "dropped", event, reason: sig.reason } });
    }
    s = runReducer(s, { type: "finish", final: "done" });
    while (s.play === "playing") s = runReducer(s, { type: "advance", scope });

    expect(s.play).toBe("done");
    const status = (id: string) => s.run.items[id]?.status;
    expect(status("adu-express-program")).toBe("unknown");
    expect(status("express-adu-address")).toBe("unknown");
    expect(status("sewer-capacity-verification")).toBe("complete");
    expect(status("meter-spot-report")).toBe("missing");
    expect(status("new-address-request")).toBe("missing");
    expect(s.run.items["meter-spot-report"].notes).toEqual(["No meter spot report attached"]);
    // Drafts come back as tokens and are restored on this device only.
    expect(s.run.items["express-applicant-name"].suggestions[0].text).toBe("Maria Ejemplo");
    expect(s.run.items["express-project-address"].suggestions[0].text).toMatch(/^1234 Placeholder Lane/);
    // The law claim was dropped by the server's verifier and shown as such; the invented id never arrived.
    const dropped = s.run.log.filter((l) => l.rejected?.startsWith("dropped by the verifier"));
    expect(dropped.map((l) => l.event.item_id)).toEqual(["b802-adu-impact-fees"]);
    expect(s.run.items["b802-adu-impact-fees"].notes).toEqual([]);
    expect(s.run.log.some((l) => l.event.item_id === "NOT-A-REAL-ITEM")).toBe(false);
    expect(s.run.pointedItem).toBe("b802-adu-impact-fees");
  });
});
