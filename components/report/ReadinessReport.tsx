"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DEFAULT_CITY, getCityConfig, loadMockEvents } from "@/components/pointer/config";
import { normalizeSource, type ChecklistItem, type Citation } from "@/components/pointer/contract";
import { foldEvents, loadDecisions, readiness, withDecisions, type Decisions } from "@/components/pointer/run-state";
import { CitationChip, StatusPill } from "@/components/ui/bits";

export function ReadinessReport() {
  const city = getCityConfig(DEFAULT_CITY)!;
  const [decisions, setDecisions] = useState<Decisions>({});
  useEffect(() => setDecisions(loadDecisions()), []);

  // The report is the end state of the whole run, folded with the same reducer the editor uses.
  const run = withDecisions(foldEvents(loadMockEvents().events, city), decisions);
  const r = readiness(run, city);
  const byId = Object.fromEntries(city.checklist.map((c, i) => [c.id, { c, n: i + 1 }])) as Record<string, { c: ChecklistItem; n: number }>;
  const total = city.checklist.length;
  const pct = Math.round((r.complete.length / total) * 100);

  const allCitations = new Map<string, Citation>();
  for (const s of city.sources.map(normalizeSource)) allCitations.set(s.url, s);
  for (const it of Object.values(run.items)) for (const c of it.citations) allCitations.set(c.url, c);

  const Row = ({ id }: { id: string }) => {
    const { c, n } = byId[id];
    const st = run.items[id];
    const accepted = st?.suggestions.filter((s) => s.decision === "accepted") ?? [];
    const pending = st?.suggestions.filter((s) => s.decision === "pending") ?? [];
    return (
      <li className="report-row">
        <div className="flex items-start justify-between gap-3">
          <p className="font-medium">
            <span className="mr-1.5 tabular-nums text-[var(--color-ink-soft)]">{n}.</span>
            {c.text}
          </p>
          <StatusPill status={st?.status} />
        </div>
        {st?.statusText && <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{st.statusText}</p>}
        {st?.notes.map((note, k) => (
          <p key={k} className="mt-1 text-sm">
            <span className="font-semibold">Next step:</span> {note}
          </p>
        ))}
        {accepted.map((s) => (
          <p key={s.id} className="mt-1 text-sm">
            <span className="font-semibold">Drafted (accepted):</span> {s.text}
          </p>
        ))}
        {pending.length > 0 && (
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{pending.length} drafted suggestion(s) not yet accepted or rejected in the editor.</p>
        )}
      </li>
    );
  };

  return (
    <article className="mx-auto w-full max-w-3xl px-5 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-serif text-3xl">Readiness report</h1>
        <div className="flex gap-2 print:hidden">
          <Link href="/" className="btn btn-ghost">
            ← Back to editor
          </Link>
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>
            Print or save as PDF
          </button>
        </div>
      </div>
      <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
        {city.city} · ADU · checklist checked {city.checked_date ?? "unknown"} · from the mock run with a made-up applicant.
        This report is for you and your designer. Pointer does not submit it.
      </p>

      <div className="mt-6 rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
        <div className="flex items-end justify-between">
          <p className="font-serif text-4xl tabular-nums">
            {r.complete.length}
            <span className="text-xl text-[var(--color-ink-soft)]"> / {total} items complete</span>
          </p>
          <p className="text-sm text-[var(--color-ink-soft)]">{pct}%</p>
        </div>
        <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-[var(--color-cream-deep)]" aria-hidden>
          <div className="bg-[var(--color-complete)]" style={{ width: `${(r.complete.length / total) * 100}%` }} />
          <div className="bg-[var(--color-missing)]" style={{ width: `${(r.missing.length / total) * 100}%` }} />
          <div className="bg-[var(--color-unknown)]" style={{ width: `${(r.unknown.length / total) * 100}%` }} />
        </div>
        <p className="mt-2 flex flex-wrap gap-x-4 text-sm">
          <span className="text-[var(--color-complete)]">● {r.complete.length} complete</span>
          <span className="text-[var(--color-missing)]">● {r.missing.length} missing</span>
          <span className="text-[var(--color-unknown)]">● {r.unknown.length} unknown</span>
          {r.notReviewed.length > 0 && <span className="text-[var(--color-ink-soft)]">○ {r.notReviewed.length} not reviewed</span>}
        </p>
      </div>

      <Section title="Missing: fix these before you submit" ids={r.missing} Row={Row} />
      <Section title="Unknown: ask the city" ids={r.unknown} Row={Row} />
      {r.flagged.length > 0 && (
        <section className="mt-8">
          <h2 className="font-serif text-xl">Law Lens: outdated references in the city&apos;s form</h2>
          <ul className="mt-3 space-y-2">
            {r.flagged.map((id) => (
              <li key={id} className="lawlens-note rounded border-l-4 px-3 py-2 text-sm">
                <span className="font-semibold">Item {byId[id].n}:</span> {run.items[id]?.highlightText?.replace(/^Law Lens:\s*/i, "")}
              </li>
            ))}
          </ul>
        </section>
      )}
      <Section title="Complete" ids={r.complete} Row={Row} />
      {r.notReviewed.length > 0 && <Section title="Not reviewed" ids={r.notReviewed} Row={Row} />}

      <section className="mt-8">
        <h2 className="font-serif text-xl">Sources</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {[...allCitations.values()].map((c) => (
            <CitationChip key={c.url} c={c} />
          ))}
        </div>
      </section>

      <p className="mt-10 border-t border-[var(--color-line)] pt-4 text-xs text-[var(--color-ink-soft)]">
        Prototype, not legal advice. Requirements change and city documents can be out of date. Confirm every item with the
        city&apos;s permit counter and a licensed professional before you act.
      </p>
    </article>
  );
}

function Section({ title, ids, Row }: { title: string; ids: string[]; Row: (p: { id: string }) => React.ReactNode }) {
  if (ids.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="font-serif text-xl">
        {title} <span className="text-base text-[var(--color-ink-soft)]">({ids.length})</span>
      </h2>
      <ul className="mt-3 space-y-2">
        {ids.map((id) => (
          <Row key={id} id={id} />
        ))}
      </ul>
    </section>
  );
}
