"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DEFAULT_CITY, PLAN, getCityConfig, loadMockEvents } from "@/components/pointer/config";
import { normalizeSource, type Citation } from "@/components/pointer/contract";
import { documentById, stepIndexOf, type PlanTarget } from "@/components/pointer/plan";
import { foldEvents, loadDecisions, readiness, withDecisions, type Decisions } from "@/components/pointer/run-state";
import { CitationChip, StatusPill } from "@/components/ui/bits";

export function ReadinessReport() {
  const city = getCityConfig(DEFAULT_CITY)!;
  const [decisions, setDecisions] = useState<Decisions>({});
  useEffect(() => setDecisions(loadDecisions()), []);

  // The report is the end state of the whole run, folded with the same reducer the editor uses,
  // over every plan target (checklist boxes, form fields, files, fee sheet), not just the checklist.
  const scope = { checklist: PLAN.targets };
  const run = withDecisions(foldEvents(loadMockEvents().events, scope), decisions);
  const r = readiness(run, scope);
  const byId = Object.fromEntries(PLAN.targets.map((t) => [t.id, t])) as Record<string, PlanTarget>;
  const total = PLAN.targets.length;
  const pct = Math.round((r.complete.length / total) * 100);
  const where = (t: PlanTarget) => {
    const step = PLAN.steps[stepIndexOf(PLAN, t.id)];
    const doc = documentById(PLAN, t.doc);
    return `${step ? `Step ${stepIndexOf(PLAN, t.id) + 1} · ${step.title}` : ""}${doc ? ` · ${doc.title}${t.page ? `, p. ${t.page}` : ""}` : ""}`;
  };

  const allCitations = new Map<string, Citation>();
  for (const s of city.sources.map(normalizeSource)) allCitations.set(s.url, s);
  for (const d of PLAN.documents) if (d.source_url) allCitations.set(d.source_url, { title: d.title, url: d.source_url, checked_date: d.checked_date ?? undefined });
  for (const it of Object.values(run.items)) for (const c of it.citations) allCitations.set(c.url, c);

  const Row = ({ id }: { id: string }) => {
    const t = byId[id];
    const st = run.items[id];
    const accepted = st?.suggestions.filter((s) => s.decision === "accepted") ?? [];
    const pending = st?.suggestions.filter((s) => s.decision === "pending") ?? [];
    return (
      <li className="box-row">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">{t.label}</p>
            <p className="mt-0.5 text-xs text-[var(--fg-muted)]">{where(t)}</p>
          </div>
          <StatusPill status={st?.status} />
        </div>
        {st?.statusText && <p className="mt-1 text-sm text-[var(--fg-muted)]">{st.statusText}</p>}
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
          <p className="mt-1 text-sm text-[var(--fg-muted)]">{pending.length} drafted suggestion(s) not yet accepted or rejected in the editor.</p>
        )}
      </li>
    );
  };

  return (
    <article className="mx-auto w-full max-w-4xl px-4 py-8 md:px-6">
      <div className="border-b border-[var(--border-muted)] pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl">Readiness report</h1>
          <div className="flex gap-2 print:hidden">
            <Link href="/" className="btn btn-ghost">
              ← Back to editor
            </Link>
            <button type="button" className="btn btn-primary" onClick={() => window.print()}>
              Print or save as PDF
            </button>
          </div>
        </div>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">
          {city.city} · ADU · {PLAN.steps.length} steps across {PLAN.documents.length} documents · checked {PLAN.checked_date ?? "unknown"} · from the scripted run with a made-up applicant.
          This report is for you and your designer. Pointer does not submit it.
        </p>
      </div>

      <div className="box anim-fade-up mt-6">
        <div className="box-header justify-between">
          <h2 className="box-title">Plan progress</h2>
          <span className="text-sm tabular-nums text-[var(--fg-muted)]">{pct}%</span>
        </div>
        <div className="p-4">
          <p className="text-3xl font-semibold tracking-tight tabular-nums">
            {r.complete.length}
            <span className="text-base font-normal text-[var(--fg-muted)]"> / {total} items complete</span>
          </p>
          <div className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-full bg-[var(--bg-muted)]" aria-hidden>
            <div className="bg-[var(--success-emphasis)]" style={{ width: `${(r.complete.length / total) * 100}%` }} />
            <div className="bg-[var(--danger)]" style={{ width: `${(r.missing.length / total) * 100}%` }} />
            <div className="bg-[var(--neutral)]" style={{ width: `${(r.unknown.length / total) * 100}%` }} />
          </div>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span className="text-[var(--success)]">● {r.complete.length} complete</span>
            <span className="text-[var(--danger)]">● {r.missing.length} missing</span>
            <span className="text-[var(--neutral)]">● {r.unknown.length} unknown</span>
            {r.drafted.length > 0 && <span className="text-[var(--accent)]">◐ {r.drafted.length} drafted, waiting on you</span>}
            {r.notReviewed.length > 0 && <span className="text-[var(--fg-muted)]">○ {r.notReviewed.length} not reviewed</span>}
          </p>
        </div>
      </div>

      <Section title="Missing: fix these before you submit" ids={r.missing} Row={Row} />
      <Section title="Unknown: ask the city" ids={r.unknown} Row={Row} />
      <Section title="Drafted: accept or reject in the editor" ids={r.drafted} Row={Row} />
      {r.flagged.length > 0 && (
        <section className="box mt-6">
          <h2 className="box-header box-title">
            Law Lens: outdated references in the city&apos;s form <span className="counter">{r.flagged.length}</span>
          </h2>
          <ul>
            {r.flagged.map((id) => (
              <li key={id} className="box-row text-sm">
                <div className="lawlens-note rounded-md border-l-4 px-3 py-2">
                  <p>
                    <span className="font-semibold">{byId[id].label}:</span>{" "}
                    {run.items[id]?.statute
                      ? `cites Gov. Code ${run.items[id]!.statute!.old}, now ${run.items[id]!.statute!.new_range}. May be out of date; confirm with the city.`
                      : run.items[id]?.highlightText ?? "flagged for review."}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--fg-muted)]">{where(byId[id])}</p>
                  {run.items[id]?.statute && (
                    <div className="mt-1.5">
                      <CitationChip
                        c={{
                          title: run.items[id]!.statute!.title,
                          url: run.items[id]!.statute!.source_url,
                          checked_date: run.items[id]!.statute!.checked_date,
                        }}
                      />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Section title="Complete" ids={r.complete} Row={Row} />
      {r.notReviewed.length > 0 && <Section title="Not reviewed" ids={r.notReviewed} Row={Row} />}

      <section className="box mt-6">
        <h2 className="box-header box-title">
          Sources <span className="counter">{allCitations.size}</span>
        </h2>
        <div className="flex flex-wrap gap-2 p-4">
          {[...allCitations.values()].map((c) => (
            <CitationChip key={c.url} c={c} />
          ))}
        </div>
      </section>

      <p className="mt-10 border-t border-[var(--border-muted)] pt-4 text-xs text-[var(--fg-muted)]">
        Prototype, not legal advice. Requirements change and city documents can be out of date. Confirm every item with the
        city&apos;s permit counter and a licensed professional before you act.
      </p>
    </article>
  );
}

function Section({ title, ids, Row }: { title: string; ids: string[]; Row: (p: { id: string }) => React.ReactNode }) {
  if (ids.length === 0) return null;
  return (
    <section className="box mt-6">
      <h2 className="box-header box-title">
        {title} <span className="counter">{ids.length}</span>
      </h2>
      <ul>
        {ids.map((id) => (
          <Row key={id} id={id} />
        ))}
      </ul>
    </section>
  );
}
