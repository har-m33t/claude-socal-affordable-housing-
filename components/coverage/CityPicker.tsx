"use client";
// City picker over the real configs. Every city with a config is listed and every
// one of them is selectable: an unverified city is not hidden and not disabled,
// because a permit tech looking for their own city needs to find it and be told
// why Pointer has nothing for it. Picking one is answered by
// `UnverifiedCityNotice`, never by silence.
//
// Verified and unverified are distinguished three ways over, so it does not rest
// on colour alone: an optgroup heading, a suffix on the label, and the live count
// in the hint.
import { COVERAGE, COVERAGE_COUNTS } from "@/components/pointer/config";
import type { CoverageRow } from "@/components/pointer/contract";

export function CityPicker({
  value,
  onChange,
  cities = COVERAGE,
  label = "City",
  id = "city-picker",
}: {
  value: string;
  onChange: (city: string) => void;
  /** Defaults to every real config. Pass a subset only to narrow deliberately. */
  cities?: CoverageRow[];
  label?: string;
  id?: string;
}) {
  const live = cities.filter((c) => c.verified);
  const pending = cities.filter((c) => !c.verified);

  return (
    <label className="picker" htmlFor={id}>
      <span className="picker-label">{label}</span>
      <select id={id} className="picker-select" value={value} onChange={(e) => onChange(e.target.value)}>
        <optgroup label={`Live — checklist read (${live.length})`}>
          {live.map((c) => (
            <option key={c.city} value={c.city}>
              {c.city} · live
            </option>
          ))}
        </optgroup>
        <optgroup label={`Not yet read (${pending.length}) — no advice`}>
          {pending.map((c) => (
            <option key={c.city} value={c.city} className="text-[var(--color-ink-soft)]">
              {c.city} · {c.status === "checklist_found" ? "checklist found, not read" : "not yet checked"}
            </option>
          ))}
        </optgroup>
      </select>
      <span className="picker-hint">
        {live.length} of {cities.length} live
        {cities === COVERAGE && COVERAGE_COUNTS.checklist_found > 0
          ? ` · ${COVERAGE_COUNTS.checklist_found} with a checklist found`
          : ""}
      </span>
    </label>
  );
}

export default CityPicker;
