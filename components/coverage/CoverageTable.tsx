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
    <article className="mx-auto w-full max-w-4xl px-5 py-8">
      <h1 className="font-serif text-3xl">Coverage: {COVERAGE.length} Orange County cities</h1>
      <p className="mt-2 max-w-2xl text-[var(--color-ink-soft)]">
        A new city is a new config file. A city goes live only after a person has read its checklist and recorded the date.
        Until then Pointer shows &ldquo;not yet verified&rdquo; and gives no guidance for it.
      </p>
      <div className="mt-5 flex flex-wrap gap-2 text-sm">
        {(Object.keys(LABEL) as CoverageStatus[]).map((s) => (
          <span key={s} className={`pill cov-${s}`}>
            {counts[s] ?? 0} {LABEL[s].toLowerCase()}
          </span>
        ))}
      </div>
      <div className="mt-5 overflow-x-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)]">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-[var(--color-line)] bg-[var(--color-cream-deep)] text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">
            <tr>
              <th className="px-4 py-2.5 font-medium">City</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Checked</th>
              <th className="px-4 py-2.5 font-medium">Checklist</th>
            </tr>
          </thead>
          <tbody>
            {COVERAGE.map((r) => (
              <tr key={r.city} className={`border-b border-[var(--color-line)] last:border-0 ${r.status === "live" ? "" : "text-[var(--color-ink-soft)]"}`}>
                <td className={`px-4 py-2 ${r.status === "live" ? "font-semibold text-[var(--color-ink)]" : ""}`}>{r.city}</td>
                <td className="px-4 py-2">
                  <span className={`pill cov-${r.status}`}>{LABEL[r.status]}</span>
                </td>
                <td className="px-4 py-2 tabular-nums">{r.checked_date ?? "—"}</td>
                <td className="px-4 py-2">
                  {r.checklist_url && isSafeUrl(r.checklist_url) ? (
                    <a className="text-[var(--color-terracotta)] underline underline-offset-2" href={r.checklist_url} target="_blank" rel="noopener noreferrer">
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
        City list: the 34 incorporated OC cities from the event bundle&apos;s <code>oc-cities.json</code>. Statuses are mock data until
        the data team&apos;s city files land.
      </p>
    </article>
  );
}
