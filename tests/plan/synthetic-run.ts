// A small, made-up event list for tests. Built from the real plan's targets
// (data/plans/anaheim-adu.json) and a confirmed statute (data/statutes.json), so
// a renamed target or statute breaks the tests instead of silently passing.
// It is test data only: the app has no recorded run.
import type { AgentEvent, StatuteRef } from "@/components/pointer/contract";
import type { Plan } from "@/components/pointer/plan";
import planJson from "@/data/plans/anaheim-adu.json";
import statutesJson from "@/data/statutes.json";

export const PLAN_DATA = planJson as unknown as Plan;

const target = (id: string): string => {
  if (!PLAN_DATA.targets.some((t) => t.id === id)) throw new Error(`synthetic run: no plan target "${id}"`);
  return id;
};

/** The statute a highlight carries, copied field by field from data/statutes.json as the server does. */
export const STATUTE: StatuteRef = (() => {
  const s = (statutesJson as { statutes: (StatuteRef & { confirmed?: boolean })[] }).statutes.find((x) => x.confirmed);
  if (!s) throw new Error("synthetic run: no confirmed statute in data/statutes.json");
  return { id: s.id, old: s.old, new_range: s.new_range, title: s.title, source_url: s.source_url, checked_date: s.checked_date };
})();

let second = 0;
const ts = () => new Date(Date.UTC(2026, 10, 7, 12, 0, second++)).toISOString();

export function syntheticEvents(): AgentEvent[] {
  second = 0;
  return [
    { tool: "point_to", item_id: target("file-sewer-capacity-email"), ts: ts() },
    { tool: "mark_item", item_id: target("sewer-capacity-verification"), status: "complete", text: "Sewer verification email attached", ts: ts() },
    { tool: "point_to", item_id: target("meter-spot-report"), ts: ts() },
    { tool: "mark_item", item_id: target("meter-spot-report"), status: "missing", ts: ts() },
    { tool: "add_note", item_id: target("meter-spot-report"), text: "No meter spot report attached", ts: ts() },
    { tool: "mark_item", item_id: target("adu-express-program"), status: "unknown", ts: ts() },
    { tool: "point_to", item_id: target("jadu-owner-occupancy-covenant"), ts: ts() },
    { tool: "highlight", item_id: target("jadu-owner-occupancy-covenant"), text: "Cites an old section number", statute_ref: STATUTE, ts: ts() },
    { tool: "point_to", item_id: target("express-project-address"), ts: ts() },
    { tool: "draft_field", item_id: target("express-project-address"), text: "1234 Placeholder Lane, Anaheim, CA 00000", ts: ts() },
    { tool: "draft_field", item_id: target("express-applicant-name"), text: "Maria Ejemplo", ts: ts() },
  ];
}
