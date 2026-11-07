"use client";

import { useId, type ReactNode } from "react";
import { REDACTION_KINDS, TOKEN_PATTERN, type RedactionKind, type RedactionSpan } from "./redact";

export interface RedactionPreviewProps {
  /** The text as extracted from the homeowner's file. Shown only in the "before" pane. */
  original: string;
  /** The redacted text: exactly what is sent to the server. */
  redacted: string;
  /** Spans from `redact()` for this text. Used to mark what was hidden. */
  spans: readonly RedactionSpan[];
  /** Extra classes for the outer element (spacing, width, theme overrides). */
  className?: string;
  /** Heading for the panel. */
  title?: string;
}

const KIND_LABEL: Record<RedactionKind, [singular: string, plural: string]> = {
  NAME: ["name", "names"],
  ADDRESS: ["address", "addresses"],
  PHONE: ["phone number", "phone numbers"],
  EMAIL: ["email", "emails"],
  APN: ["parcel number (APN)", "parcel numbers (APN)"],
};

/** Distinct values hidden per kind (one token = one value). */
export function countByKind(spans: readonly RedactionSpan[]): Record<RedactionKind, number> {
  const seen = new Set<string>();
  const counts: Record<RedactionKind, number> = { NAME: 0, ADDRESS: 0, PHONE: 0, EMAIL: 0, APN: 0 };
  for (const s of spans) {
    if (seen.has(s.token)) continue;
    seen.add(s.token);
    counts[s.kind] += 1;
  }
  return counts;
}

const ACCENT_MARK =
  "rounded-sm px-0.5 font-semibold text-[#b5523b] bg-[#b5523b]/10 ring-1 ring-inset ring-[#b5523b]/40";

function renderBefore(original: string, spans: readonly RedactionSpan[]): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;
  const ordered = [...spans].sort((a, b) => a.start - b.start);
  for (const s of ordered) {
    if (s.start < cursor || s.end > original.length) continue; // ignore spans that do not fit
    parts.push(original.slice(cursor, s.start));
    parts.push(
      <mark
        key={`b${s.start}`}
        data-kind={s.kind}
        title={`Hidden as ${s.token}`}
        className="rounded-sm bg-transparent px-0.5 text-inherit underline decoration-[#b5523b] decoration-wavy decoration-1 underline-offset-2"
      >
        {original.slice(s.start, s.end)}
        <span className="sr-only"> (hidden as {s.token})</span>
      </mark>,
    );
    cursor = s.end;
  }
  parts.push(original.slice(cursor));
  return parts;
}

function renderAfter(redacted: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const m of redacted.matchAll(TOKEN_PATTERN)) {
    parts.push(redacted.slice(cursor, m.index));
    parts.push(
      <mark key={`a${m.index}`} data-kind={m[1]} data-token={m[0]} className={ACCENT_MARK}>
        {m[0]}
      </mark>,
    );
    cursor = m.index + m[0].length;
  }
  parts.push(redacted.slice(cursor));
  return parts;
}

/**
 * Before-and-after view of redaction. The "before" pane renders only in this
 * browser; nothing in this component sends, stores or logs text.
 */
export function RedactionPreview({
  original,
  redacted,
  spans,
  className,
  title = "What leaves your device",
}: RedactionPreviewProps) {
  const id = useId();
  const counts = countByKind(spans);
  const kinds = REDACTION_KINDS.filter((k) => counts[k] > 0);
  const paneClass =
    "m-0 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-stone-300 bg-white/70 p-3 font-mono text-sm leading-relaxed text-stone-900";

  return (
    <section
      aria-labelledby={`${id}-title`}
      className={["rounded-lg border border-stone-300 bg-[#fbf7ef] p-4 text-stone-900", className]
        .filter(Boolean)
        .join(" ")}
    >
      <h2 id={`${id}-title`} className="font-serif text-xl text-[#b5523b]">
        {title}
      </h2>

      {kinds.length > 0 ? (
        <ul aria-label="Hidden before sending" className="mt-2 flex flex-wrap gap-2 text-sm">
          {kinds.map((k) => (
            <li
              key={k}
              data-kind={k}
              className="rounded-full border border-[#b5523b]/40 bg-[#b5523b]/10 px-2 py-0.5"
            >
              <strong>{counts[k]}</strong> {KIND_LABEL[k][counts[k] === 1 ? 0 : 1]} hidden
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm">No names, addresses, phone numbers, emails or parcel numbers were found.</p>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section aria-labelledby={`${id}-before`} data-pane="before">
          <h3 id={`${id}-before`} className="mb-1 font-serif text-base">
            Before (stays on this device)
          </h3>
          <pre className={paneClass}>{renderBefore(original, spans)}</pre>
        </section>
        <section aria-labelledby={`${id}-after`} data-pane="after">
          <h3 id={`${id}-after`} className="mb-1 font-serif text-base">
            After (what is sent to Claude)
          </h3>
          <pre className={paneClass}>{renderAfter(redacted)}</pre>
        </section>
      </div>

      <p className="mt-3 text-xs text-stone-600">
        The key that turns each token back into the real value stays in this browser tab. It is
        never saved or sent.
      </p>
    </section>
  );
}

export default RedactionPreview;
