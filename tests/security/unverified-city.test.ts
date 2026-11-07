/**
 * Security: an unverified city returns no advice.
 *
 * ASSUMPTIONS TEAM 3 / TEAM 1 MUST CONFIRM (all isolated in helpers/route-harness.ts):
 *  - Route: app/api/agent/route.ts exports POST(req: Request): Promise<Response>.
 *  - Request body: { city, type, documents: [{ name, declared_type, text }] }.
 *  - Response: text/event-stream, one `data: <event JSON>\n\n` frame per agent action;
 *    a refusal may instead be a non-stream error response (e.g. 403 JSON).
 *  - Cities: data/cities/<city>.json; "brea" is an unverified stub, "anaheim" verified.
 *  - Claude is reached only through @anthropic-ai/sdk with the global fetch.
 *
 * For an unverified city the route must make ZERO requests to Anthropic, ZERO other
 * outbound requests, and stream at most add_note events saying it is not yet verified.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkCityData, checkUnverifiedCityRun } from "./helpers/checks";
import type { CityConfig } from "./helpers/contracts";
import { FakeAnthropic, obedientScript } from "./helpers/fake-anthropic";
import {
  REAL_CITY_DIR,
  REAL_UNVERIFIED_CITY,
  REAL_VERIFIED_CITY,
  REPO_ROOT,
  loadCity,
  missingForRealRoute,
  realRouteTarget,
  referenceTarget,
  runRoute,
  skipReason,
  type RouteTarget,
} from "./helpers/route-harness";

/** Cities allowed to be verified. Adding one is a deliberate, reviewed change. */
const VERIFIED_ALLOWLIST = [REAL_VERIFIED_CITY];

async function runUnverified(target: RouteTarget) {
  const fake = new FakeAnthropic(obedientScript(["SOME-ITEM"]));
  const run = await runRoute(
    target,
    {
      city: target.unverifiedCity,
      projectType: target.projectType,
      question: "What is still missing from my packet?",
      documents: [{ name: "site-plan.pdf", declared_type: "site_plan", text: "Made-up site plan text for a test." }],
    },
    { kind: "fake", fake },
  );
  return { run, fake, violations: checkUnverifiedCityRun(run, fake.requests.length, fake.blocked) };
}

describe("unverified city: reference fixtures prove the check", () => {
  it("safe reference route: no violations, and it says the city is not verified", async () => {
    const { run, violations } = await runUnverified(referenceTarget("safe"));
    expect(violations).toEqual([]);
    expect(run.events.map((e) => e.tool)).toEqual(["add_note"]);
  });

  it("unsafe reference route (no gate): reports the model call, the webhook and the advice", async () => {
    const { violations } = await runUnverified(referenceTarget("unsafe"));
    const all = violations.join("\n");
    expect(all).toMatch(/request\(s\) to Anthropic for an unverified city/);
    expect(all).toMatch(/outbound request for an unverified city: fetch https:\/\/hooks\.example\.com/);
    expect(all).toMatch(/"mark_item" streamed for an unverified city/);
    expect(all).toMatch(/"submit_application" streamed for an unverified city/);
  });

  it("raw-socket reference route: an outbound call that bypasses fetch (node:https) is still caught", async () => {
    const target = { ...referenceTarget("safe"), label: "raw-socket fixture", modulePath: referenceTarget("safe").modulePath.replace("safe-route", "raw-socket-route") };
    const { violations } = await runUnverified(target);
    expect(violations.join("\n")).toMatch(/outbound request for an unverified city: node:https\.request https:\/\/hooks\.example\.com/);
  });
});

const missingRoute = missingForRealRoute([REAL_UNVERIFIED_CITY]);
describe.skipIf(missingRoute.length > 0)(`unverified city: real route ${skipReason(missingRoute)}`, () => {
  it(`"${realRouteTarget().unverifiedCity}" gets no advice, no model call, no outbound call`, async () => {
    const { violations } = await runUnverified(realRouteTarget());
    expect(violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Data-level check

function readCities(dir: string): CityConfig[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as CityConfig);
}

describe("city data: only allowlisted cities are verified, and verified ones are sourced", () => {
  it("passes for the fixture cities and catches unsafe data", () => {
    const fixtures = readCities(referenceTarget("safe").cityDir);
    expect(checkCityData(fixtures, ["anaheim-fixture"])).toEqual([]);

    const anaheim = loadCity(referenceTarget("safe"), "anaheim-fixture");
    const unsafe: CityConfig[] = [
      { city: "stub-marked-verified", verified: true, checked_date: "2026-01-01", sources: ["x"] },
      { city: "anaheim-fixture", verified: true, checked_date: null, sources: [] },
      { city: "stub-no-flag", verified: "false" as unknown as boolean },
    ];
    const violations = checkCityData(unsafe, [anaheim.city]).join("\n");
    expect(violations).toContain("stub-marked-verified: verified is true but the city is not on the verified allowlist");
    expect(violations).toContain("anaheim-fixture: verified city needs checked_date");
    expect(violations).toContain("anaheim-fixture: verified city needs at least one source");
    expect(violations).toContain("stub-no-flag: verified must be a boolean");
  });

  const cityDir = join(REPO_ROOT, REAL_CITY_DIR);
  it.skipIf(!existsSync(cityDir))(
    `real city files in ${REAL_CITY_DIR}/${existsSync(cityDir) ? "" : ` (waiting for Team 1: ${REAL_CITY_DIR}/ missing)`}`,
    () => {
      expect(checkCityData(readCities(cityDir), VERIFIED_ALLOWLIST)).toEqual([]);
    },
  );
});
