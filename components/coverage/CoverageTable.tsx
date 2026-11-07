"use client";
// Coverage, built from data/cities/*.json and nothing else. Every count on this
// page is derived from the configs the app actually loads, so the page cannot say
// a city is live while the editor refuses to advise on it.
import { useState } from "react";
import { COVERAGE, COVERAGE_COUNTS, DEFAULT_CITY, getCityStatus } from "@/components/pointer/config";
import { isSafeUrl, type CoverageStatus } from "@/components/pointer/contract";
import { CityPicker } from "./CityPicker";
import { UnverifiedCityNotice } from "./UnverifiedCityNotice";

const LABEL: Record<CoverageStatus, string> = {
  live: "Live",
  checklist_found: "Checklist found",
  not_checked: "Not yet checked",
};

export function CoverageTable() {
  const [selected, setSelected] = useState(DEFAULT_CITY);
  const status = getCityStatus(selected);

  return (
    <article className="mx-auto w-full max-w-4xl px-5 py-8">
      <h1 className="font-serif text-3xl">
        Coverage: {COVERAGE_COUNTS.live} of {COVERAGE_COUNTS.total} Orange County cities live
      </h1>
      <p className="mt-2 max-w-2xl text-[var(--color-ink-soft)]">
        A city is a config file in <code>data/cities/</code>. It goes live only once a person has read its submittal
        checklist and recorded the date. Until then Pointer gives no guidance for it — and says so, with what is missing.
        Every city below is selectable, including the ones Pointer cannot help with yet.
      </p>

      <div className="mt-5 flex flex-wrap gap-2 text-sm">
        {(Object.keys(LABEL) as CoverageStatus[]).map((s) => (
          <span key={s} className={`pill cov-${s}`}>
            {COVERAGE_COUNTS[s]} {LABEL[s].toLowerCase()}
          </span>
        ))}
      </div>

      <div className="mt-6 rounded-lg border border-[var(--color-line)] bg-[var(--color-cream-deep)] p-4">
        <CityPicker value={selected} onChange={setSelected} label="Look up a city" id="coverage-city" />
        <div className="mt-4 border-t border-[var(--color-line)] pt-4">
          <h2 className="font-serif text-2xl">{status.headline}</h2>
          {status.verified ? (
            <div className="mt-2 text-sm leading-relaxed">
              <p>{status.explanation[0]}</p>
              <p className="mt-2 text-[var(--color-ink-soft)]">
                {status.checklistItemsUsable} checklist item{status.checklistItemsUsable === 1 ? "" : "s"} ·{" "}
                {status.sources.length} source{status.sources.length === 1 ? "" : "s"} ·{" "}
                {status.hasChecklistPdf ? "checklist PDF on file" : "no checklist PDF on file"} · checked{" "}
                {status.checkedDate ?? "unknown"}
              </p>
              {status.checklistUrl && isSafeUrl(status.checklistUrl) && (
                <a
                  className="mt-2 inline-block text-[var(--color-terracotta)] underline underline-offset-2"
                  href={status.checklistUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  The checklist this came from ↗
                </a>
              )}
            </div>
          ) : (
            <UnverifiedCityNotice city={selected} compact className="mt-2" />
          )}
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)]">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">
            Every Orange County city with a Pointer config, and whether its checklist has been read.
          </caption>
          <thead className="border-b border-[var(--color-line)] bg-[var(--color-cream-deep)] text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">
                City
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Checked
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Checklist
              </th>
            </tr>
          </thead>
          <tbody>
            {COVERAGE.map((r) => (
              <tr
                key={r.city}
                className={`border-b border-[var(--color-line)] last:border-0 ${
                  r.verified ? "" : "text-[var(--color-ink-soft)]"
                } ${r.city === selected ? "bg-[var(--color-cream-deep)]" : ""}`}
              >
                <td className={`px-4 py-2 ${r.verified ? "font-semibold text-[var(--color-ink)]" : ""}`}>
                  <button
                    type="button"
                    className="text-left underline-offset-2 hover:underline"
                    aria-pressed={r.city === selected}
                    onClick={() => setSelected(r.city)}
                  >
                    {r.city}
                  </button>
                </td>
                <td className="px-4 py-2">
                  <span className={`pill cov-${r.status}`}>{LABEL[r.status]}</span>
                </td>
                <td className="px-4 py-2 tabular-nums">{r.checked_date ?? "—"}</td>
                <td className="px-4 py-2">
                  {r.checklist_url && isSafeUrl(r.checklist_url) ? (
                    <a
                      className="text-[var(--color-terracotta)] underline underline-offset-2"
                      href={r.checklist_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open ↗
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-[var(--color-ink-soft)]">
        Rows come from the {COVERAGE_COUNTS.total} config files in <code>data/cities/</code>. The status, date and checklist
        link are read from each city&apos;s own config — a city is never shown as live because a list somewhere says so. A
        blank date or checklist means the config does not record one, not that the city has no requirements.
      </p>
    </article>
  );
}
