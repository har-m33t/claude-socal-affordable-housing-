import { COVERAGE } from "@/components/pointer/config";
import { isSafeUrl, type CoverageStatus } from "@/components/pointer/contract";

const LABEL: Record<CoverageStatus, string> = {
  live: "Live",
  checklist_found: "Checklist found",
  not_checked: "Not yet checked",
};

export function CoverageTable() {
  const counts = COVERAGE.reduce(
    (acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }),
    {} as Partial<Record<CoverageStatus, number>>,
  );
  return (
    <article className="mx-auto w-full max-w-5xl px-4 py-8 md:px-6">
      <h1 className="text-2xl">Coverage: {COVERAGE.length} Orange County cities</h1>
      <p className="mt-2 max-w-2xl text-[var(--fg-muted)]">
        A new city is a new config file. A city goes live only after a person has read its checklist and recorded the date.
        Until then Pointer shows &ldquo;not yet verified&rdquo; and gives no guidance for it.
      </p>
      <div className="box mt-6 overflow-hidden">
        <div className="box-header flex-wrap justify-between">
          <h2 className="box-title">
            Cities <span className="counter ml-1">{COVERAGE.length}</span>
          </h2>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(LABEL) as CoverageStatus[]).map((s) => (
              <span key={s} className={`pill cov-${s}`}>
                {counts[s] ?? 0} {LABEL[s].toLowerCase()}
              </span>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--border)] text-xs text-[var(--fg-muted)]">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">City</th>
                <th className="px-4 py-2 text-left font-semibold">Status</th>
                <th className="px-4 py-2 text-left font-semibold">Checked</th>
                <th className="px-4 py-2 text-left font-semibold">Checklist</th>
              </tr>
            </thead>
            <tbody>
              {COVERAGE.map((r) => (
                <tr
                  key={r.city}
                  className={`border-b border-[var(--border-muted)] transition-colors last:border-0 hover:bg-[var(--bg-subtle)] ${r.status === "live" ? "" : "text-[var(--fg-muted)]"}`}
                >
                  <td className={`px-4 py-2.5 ${r.status === "live" ? "font-semibold text-[var(--fg)]" : ""}`}>{r.city}</td>
                  <td className="px-4 py-2.5">
                    <span className={`pill cov-${r.status}`}>{LABEL[r.status]}</span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs tabular-nums">{r.checked_date ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    {r.checklist_url && isSafeUrl(r.checklist_url) ? (
                      <a className="link" href={r.checklist_url} target="_blank" rel="noopener noreferrer">
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
      </div>
      <p className="mt-3 text-xs text-[var(--fg-muted)]">
        City list: the 34 incorporated OC cities from the event bundle&apos;s <code>oc-cities.json</code>. Statuses are mock data until
        the data team&apos;s city files land.
      </p>
    </article>
  );
}
