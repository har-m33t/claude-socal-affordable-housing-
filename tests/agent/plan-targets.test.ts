/**
 * The live agent accepts the plan's PDF target ids (ADU Express form fields,
 * the B802 impact-fee note), because loadCityFromDisk merges them into the
 * loaded city's checklist, which is the item_id allowlist.
 */
import { PACKET_DOC_TYPE } from "@/lib/plan/constants";
import { readFileSync } from "node:fs";
import * as nodePath from "node:path";
import { describe, expect, it } from "vitest";

import { loadCityFromDisk } from "../../lib/agent/loop";
import { validateToolInput } from "../../lib/agent/tools";
import type { CityConfig } from "../../lib/agent/types";
import { mergePlanTargets } from "../../lib/plan/load";
import type { Plan } from "../../components/pointer/plan";

const APP_ROOT = process.cwd();
const rawCity = JSON.parse(
  readFileSync(nodePath.join(APP_ROOT, "data/cities/anaheim.json"), "utf8"),
) as CityConfig;
const plan = JSON.parse(
  readFileSync(nodePath.join(APP_ROOT, "data/plans/anaheim-adu.json"), "utf8"),
) as Plan;

describe("plan targets as agent item_ids", () => {
  it("accepts a form-field and a B802 target id once the plan is merged", async () => {
    const city = await loadCityFromDisk(APP_ROOT, "Anaheim");
    for (const id of ["express-applicant-name", "b802-adu-impact-fees"]) {
      const result = validateToolInput("point_to", { item_id: id }, city);
      expect(result.ok, id).toBe(true);
    }
    const field = city.checklist.find((c) => c.id === "express-applicant-name");
    expect(field).toMatchObject({ page: 1, doc_type: "express", source: "https://www.anaheim.net/DocumentCenter/View/49140/" });
    expect(field?.box).toHaveLength(4);
  });

  it("rejects the same id against the city file alone (the merge is what allows it)", () => {
    const result = validateToolInput("point_to", { item_id: "express-applicant-name" }, rawCity);
    expect(result.ok).toBe(false);
  });

  it("keeps the city's own items first and unchanged, adds file-board targets without boxes, and keeps verified/fast_paths", async () => {
    const city = await loadCityFromDisk(APP_ROOT, "Anaheim");
    expect(city.checklist.slice(0, rawCity.checklist.length)).toEqual(rawCity.checklist);
    expect(city.verified).toBe(rawCity.verified);
    expect(city.fast_paths).toEqual(rawCity.fast_paths);
    const ids = city.checklist.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    // File-board targets are named (so live runs cover steps 1 and 13) but have no page or box;
    // every other merged item is a measured PDF box.
    for (const c of city.checklist) {
      if (c.doc_type === PACKET_DOC_TYPE) expect([c.page, c.box], c.id).toEqual([null, null]);
      else expect(c.box, c.id).not.toBeNull();
    }
    expect(ids).toContain("file-floor-plan");
    expect(ids).toContain("packet-summary");
  });

  it("does not mutate its input", () => {
    const before = JSON.stringify(rawCity);
    mergePlanTargets(rawCity, [plan]);
    expect(JSON.stringify(rawCity)).toBe(before);
  });
});
