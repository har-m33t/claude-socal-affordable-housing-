/**
 * Server-side plan loading: makes the plan's PDF targets valid agent item_ids.
 *
 * The plan (data/plans/<city>-<type>.json) shares one id space with the city
 * checklist. The live agent's item_id allowlist is the loaded city's checklist,
 * so without this the model could not point at an ADU Express form field or the
 * B802 impact-fee note, even though the UI can. mergePlanTargets appends every
 * plan target that has a page and box and is not already a checklist item.
 *
 * Packet targets (the homeowner's file board) are NOT merged: they have no page
 * or box, and the prompt would list them as "NOT POINTABLE", which is wrong for
 * the board. They stay UI-only until the agent contract can describe them.
 */
import { readdir, readFile } from "node:fs/promises";
import * as nodePath from "node:path";

import { checkPlan, type Plan } from "@/components/pointer/plan";
import type { ChecklistItem, CityConfig } from "@/lib/agent/types";

/** The plan's pointable PDF targets as checklist items, skipping ids the city already has. */
export function planChecklistItems(plan: Plan, existingIds: ReadonlySet<string>): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  for (const t of plan.targets) {
    if (!t.page || !t.box || existingIds.has(t.id)) continue;
    const doc = plan.documents.find((d) => d.id === t.doc);
    if (doc?.kind !== "pdf") continue;
    items.push({
      id: t.id,
      text: t.text,
      page: t.page,
      box: t.box,
      doc_type: t.doc,
      source: t.source_url ?? doc.source_url ?? "",
    });
  }
  return items;
}

/** A copy of `city` whose checklist also holds the plans' PDF targets. Never mutates the input. */
export function mergePlanTargets(city: CityConfig, plans: Plan[]): CityConfig {
  const checklist = [...city.checklist];
  const ids = new Set(checklist.map((c) => c.id));
  for (const plan of plans) {
    for (const item of planChecklistItems(plan, ids)) {
      checklist.push(item);
      ids.add(item.id);
    }
  }
  return { ...city, checklist };
}

/**
 * Every plan for a city slug (data/plans/<slug>-*.json). A missing plans folder
 * means no plans; a plan that fails checkPlan throws, so a broken plan file
 * fails loudly instead of letting the agent point at the wrong place.
 */
export async function loadPlansForCity(appRoot: string, citySlug: string): Promise<Plan[]> {
  const dir = nodePath.join(appRoot, "data", "plans");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const mine = names.filter((n) => n.startsWith(`${citySlug}-`) && n.endsWith(".json")).sort();
  const plans: Plan[] = [];
  for (const name of mine) {
    const plan = JSON.parse(await readFile(nodePath.join(dir, name), "utf8")) as Plan;
    const problems = checkPlan(plan);
    if (problems.length) throw new Error(`data/plans/${name} is invalid: ${problems.join("; ")}`);
    plans.push(plan);
  }
  return plans;
}
