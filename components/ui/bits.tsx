import type { Citation, ItemStatus } from "@/components/pointer/contract";
import { isSafeUrl } from "@/components/pointer/contract";

export function CitationChip({ c }: { c: Citation }) {
  const label = (
    <>
      <svg aria-hidden width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0">
        <path d="M4 2.5h6l2.5 2.5v8.5H4z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M6 8h4.5M6 10.5h4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <span className="truncate">{c.title}</span>
      {c.checked_date && <span className="shrink-0 opacity-70">· checked {c.checked_date}</span>}
    </>
  );
  if (!isSafeUrl(c.url)) {
    return (
      <span className="chip chip-disabled" title="Link blocked: not an http(s) URL">
        {label}
      </span>
    );
  }
  return (
    <a className="chip" href={c.url} target="_blank" rel="noopener noreferrer" title={`Open source: ${c.url}`}>
      {label}
      <span aria-hidden className="shrink-0">↗</span>
    </a>
  );
}

const STATUS_LABEL: Record<ItemStatus, string> = { complete: "Complete", missing: "Missing", unknown: "Unknown" };

export function StatusPill({ status }: { status?: ItemStatus }) {
  if (!status) return <span className="pill pill-pending">Not reviewed</span>;
  return <span className={`pill pill-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function MockTag({ children = "MOCK DATA" }: { children?: React.ReactNode }) {
  return <span className="mock-tag">{children}</span>;
}
