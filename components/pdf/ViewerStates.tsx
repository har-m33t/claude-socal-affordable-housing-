"use client";
// The states the checklist viewer spends real time in when a city has no usable PDF.
// Kept out of ChecklistViewer so they can be rendered (and tested) without pdf.js.

/**
 * No `checklist_pdf` for this city at all. 33 of 34 cities are in this state today, so
 * it is the common case, not an edge case: it has to read as "not added yet", calmly,
 * and it must not look like a failure or a broken image.
 */
export function NoDocumentState({ cityName }: { cityName?: string }) {
  const who = cityName?.trim() ? cityName.trim() : "This city";
  return (
    <div className="flex h-full items-center justify-center p-8" data-testid="viewer-no-document">
      <div className="max-w-md rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] p-6 text-center">
        <DocumentGlyph />
        <h3 className="mt-3 font-serif text-lg">No checklist document yet</h3>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          {who}&rsquo;s submittal checklist PDF hasn&rsquo;t been added to Pointer yet. The checklist items beside this panel still
          apply &mdash; there is just no document to point at.
        </p>
      </div>
    </div>
  );
}

/**
 * The PDF was requested and did not arrive: 404, network error, or a file pdf.js cannot
 * parse. This has already happened in production once (a deploy-ignore rule dropped the
 * file from the bundle), so the URL that failed is shown verbatim — that is the single
 * most useful fact for whoever has to fix it.
 */
export function LoadErrorState({ url, detail }: { url: string; detail?: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8" data-testid="viewer-load-error">
      <div className="max-w-md rounded-lg border border-[var(--color-missing)] bg-[var(--color-paper)] p-6">
        <h3 className="font-serif text-lg text-[var(--color-missing)]">Could not load the checklist PDF</h3>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          Pointer asked for this file and the browser could not read it. It may have moved, or it may be missing from this
          deployment.
        </p>
        <p className="mt-3 text-xs text-[var(--color-ink-soft)]">Document URL</p>
        <code
          data-testid="viewer-load-error-url"
          className="mt-1 block break-all rounded-sm bg-[var(--color-cream-deep)] px-2 py-1 font-mono text-xs"
        >
          {url || "(no URL given)"}
        </code>
        {detail && (
          <>
            <p className="mt-3 text-xs text-[var(--color-ink-soft)]">Error</p>
            <p data-testid="viewer-load-error-detail" className="mt-1 break-words text-xs">
              {detail}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function DocumentGlyph() {
  return (
    <svg aria-hidden width="40" height="48" viewBox="0 0 40 48" className="mx-auto" fill="none">
      <path
        d="M7 3h17l9 9v33H7V3z"
        stroke="var(--color-line)"
        strokeWidth="2"
        fill="var(--color-cream-deep)"
        strokeLinejoin="round"
      />
      <path d="M24 3v9h9" stroke="var(--color-line)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M13 22h14M13 29h14M13 36h8" stroke="var(--color-line)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
