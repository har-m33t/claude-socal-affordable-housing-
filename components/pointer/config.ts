// The one place the UI loads config and events. Integrated: the city config and
// project types are now Team 1's REAL data, read first-hand from Anaheim's
// November 2025 PDF. Only the event stream is still scripted - swapping it for
// Team 3's live SSE is the remaining step.
import cityAnaheim from "@/data/cities/anaheim.json";
import typeAdu from "@/data/types/adu.json";
import citiesFixture from "@/fixtures/mock-cities.json";
import typesFixture from "@/fixtures/mock-types.json";
import packetManifest from "@/data/packet/manifest.json";
import planRunFixture from "@/fixtures/plan-run.json";
import planAnaheimAdu from "@/data/plans/anaheim-adu.json";
import { checkPlan, type Plan } from "./plan";
import {
  parseEvent,
  type AgentEvent,
  type CityConfig,
  type CoverageRow,
  type PacketFile,
  type ProjectType,
} from "./contract";

/**
 * "scripted": real city data, but the run is replayed from fixtures rather than
 * driven by the model. "live" once the editor is wired to /api/agent.
 */
export const DATA_MODE: "scripted" | "live" = "scripted";

/**
 * Team 1 records checklist_pdf as a repo path (data/docs/...). Next only serves
 * public/, so the same file is copied to public/data/docs/ and the repo path
 * maps onto the served URL by prefixing a slash.
 */
function servedPdf(repoPath: string | undefined): string {
  if (!repoPath) return "";
  return repoPath.startsWith("/") ? repoPath : `/${repoPath}`;
}

const CITY_CONFIGS: Record<string, CityConfig> = {
  Anaheim: {
    ...(cityAnaheim as unknown as CityConfig),
    checklist_pdf: servedPdf((cityAnaheim as { checklist_pdf?: string }).checklist_pdf),
  },
};

export const COVERAGE: CoverageRow[] = (citiesFixture.cities as CoverageRow[]).map((row) => ({
  ...row,
  // A city counts as verified only if its loaded config says so, whatever the coverage row says.
  verified: Boolean(CITY_CONFIGS[row.city]?.verified),
}));

export const PROJECT_TYPES: ProjectType[] = (typesFixture.types as ProjectType[]).map((t) =>
  // Team 1's real ADU pack decides whether the ADU type is verified; the rest
  // stay as the fixture lists them, which is to say not verified.
  t.type === "adu" ? { ...t, verified: Boolean((typeAdu as { verified?: boolean }).verified) } : t,
);

/** The made-up applicant's files (Team 1's packet manifest), the same files the plan's file slots name. */
export const PACKET_FILES: PacketFile[] = packetManifest.files as PacketFile[];

export function getCityConfig(city: string): CityConfig | undefined {
  return CITY_CONFIGS[city];
}

export const DEFAULT_CITY = "Anaheim";
export const DEFAULT_TYPE = "adu";

/** The scripted plan run (fixtures/plan-run.json), validated. Malformed rows are dropped and counted so the UI can show it. */
export function loadMockEvents(): { events: AgentEvent[]; dropped: number } {
  const raw = (planRunFixture as { events: unknown[] }).events;
  const events: AgentEvent[] = [];
  let dropped = 0;
  for (const r of raw) {
    const e = parseEvent(r);
    if (e) events.push(e);
    else dropped++;
  }
  return { events, dropped };
}

/** The multi-step plan for the default city and type. Invalid plans throw at load. */
export const PLAN: Plan = (() => {
  const plan = planAnaheimAdu as unknown as Plan;
  const problems = checkPlan(plan);
  if (problems.length) throw new Error(`data/plans/anaheim-adu.json is invalid: ${problems.join("; ")}`);
  return plan;
})();
