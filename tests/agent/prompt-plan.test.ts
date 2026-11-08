/**
 * The system prompt carries the city's plan, in order, so a full packet check
 * walks it step by step; only ids the validator accepts are listed.
 */
import { readFileSync } from "node:fs";
import * as nodePath from "node:path";
import { describe, expect, it } from "vitest";

import { loadCityWithPlans, runAgent, type AnthropicClientLike } from "../../lib/agent/loop";
import { buildCityBrief, buildUserContent, PLAN_WALK_RULES } from "../../lib/agent/prompt";
import type { CityConfig, ProjectTypePack, StreamFrame } from "../../lib/agent/types";

const APP_ROOT = process.cwd();
const pack = JSON.parse(readFileSync(nodePath.join(APP_ROOT, "data/types/adu.json"), "utf8")) as ProjectTypePack;

describe("prompt: the plan walk", () => {
  it("lists every plan step in order, with its kind, document and targets in order", async () => {
    const { city, plans } = await loadCityWithPlans(APP_ROOT, "Anaheim");
    const brief = buildCityBrief({ city, pack, statutes: [], handbookAttached: false, plans });
    const plan = plans[0];
    expect(plan.steps).toHaveLength(13);

    let last = -1;
    plan.steps.forEach((step, i) => {
      const at = brief.indexOf(`\n${i + 1} | ${step.title} | ${step.kind} | ${step.doc} (`);
      expect(at, step.title).toBeGreaterThan(last);
      last = at;
    });
    const formLine = brief.split("\n").find((l) => l.includes("| Application: applicant |"))!;
    const ids = [...formLine.matchAll(/(express-[a-z-]+):/g)].map((m) => m[1]);
    expect(ids).toEqual(plan.steps.find((s) => s.id === "form-applicant")!.targets);
    expect(brief).toContain(PLAN_WALK_RULES);
  });

  it("lists the file-board steps too, and marks their targets as cards on the board", async () => {
    const { city, plans } = await loadCityWithPlans(APP_ROOT, "Anaheim");
    const brief = buildCityBrief({ city, pack, statutes: [], handbookAttached: false, plans });
    const planSection = brief.slice(brief.indexOf("PLAN: "));
    expect(planSection).toMatch(/file-sewer-capacity-email/);
    expect(planSection).toMatch(/packet-summary/);
    expect(planSection).not.toMatch(/none for you/);
    expect(brief).toMatch(/file-floor-plan \|.*pointable \(a card on the homeowner's file board\)/);
  });

  it("says plainly when there is no plan", () => {
    const city: CityConfig = { city: "X", verified: true, checked_date: null, sources: [], fast_paths: [], checklist: [] };
    const brief = buildCityBrief({ city, pack, statutes: [], handbookAttached: false });
    expect(brief).toContain("PLAN: none recorded");
    expect(brief).not.toContain(PLAN_WALK_RULES);
  });

  it("tells the model its turn budget in the user turn, not the cached system prompt", () => {
    const blocks = buildUserContent({ question: "q", now: "t", maxTurns: 12 });
    expect(JSON.stringify(blocks)).toContain("at most 12 turns");
  });
});

describe("loop: plans reach the system prompt", () => {
  function captureClient(seen: unknown[]): AnthropicClientLike {
    return {
      messages: {
        stream(body) {
          seen.push(body.system);
          return {
            finalMessage: async () =>
              ({ id: "m", type: "message", role: "assistant", model: "x", content: [], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }) as never,
          };
        },
      },
    };
  }

  async function systemFor(deps: Parameters<typeof runAgent>[1]): Promise<string> {
    const seen: unknown[] = [];
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    try {
      const frames: StreamFrame[] = [];
      for await (const f of runAgent(
        { city: "Anaheim", projectType: "adu", question: "Check my packet against the plan." },
        { appRoot: APP_ROOT, readHandbook: async () => null, createClient: () => captureClient(seen), ...deps },
      ))
        frames.push(f);
      expect(frames.at(-1)).toMatchObject({ type: "status", phase: "done" });
    } finally {
      process.env.ANTHROPIC_API_KEY = "";
    }
    return JSON.stringify(seen[0]);
  }

  it("loads the city's plan from disk by default", async () => {
    expect(await systemFor({})).toContain("PLAN: Anaheim / adu");
  });

  it("an injected city gets no plan unless plans are injected too", async () => {
    const { city } = await loadCityWithPlans(APP_ROOT, "Anaheim");
    expect(await systemFor({ loadCity: async () => city })).toContain("PLAN: none recorded");
  });
});
