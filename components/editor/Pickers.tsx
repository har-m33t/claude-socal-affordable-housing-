"use client";
import type { CoverageRow, ProjectType } from "@/components/pointer/contract";

/** City and project-type pickers. Unverified configs stay visible but greyed out and can't be chosen. */
export function Pickers({
  cities,
  types,
  city,
  type,
  onCity,
  onType,
}: {
  cities: CoverageRow[];
  types: ProjectType[];
  city: string;
  type: string;
  onCity: (c: string) => void;
  onType: (t: string) => void;
}) {
  const verifiedCount = cities.filter((c) => c.verified).length;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="picker">
        <span className="picker-label">City</span>
        <select value={city} onChange={(e) => onCity(e.target.value)} className="picker-select">
          {cities.map((c) => (
            <option key={c.city} value={c.city} disabled={!c.verified} className={c.verified ? "" : "text-neutral-400"}>
              {c.city}
              {c.verified ? "" : " (not yet verified)"}
            </option>
          ))}
        </select>
        <span className="picker-hint">
          {verifiedCount} of {cities.length} verified
        </span>
      </label>
      <label className="picker">
        <span className="picker-label">Project type</span>
        <select value={type} onChange={(e) => onType(e.target.value)} className="picker-select">
          {types.map((t) => (
            <option key={t.type} value={t.type} disabled={!t.verified}>
              {t.name}
              {t.verified ? "" : ` (${t.note ?? "not yet verified"})`}
            </option>
          ))}
        </select>
        <span className="picker-hint">Greyed-out options give no advice</span>
      </label>
    </div>
  );
}
