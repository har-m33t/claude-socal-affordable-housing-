"use client";
/**
 * The homeowner's files (the plan's "packet" document): a card per file slot the
 * plan names (`data-target-id` = the slot's target id, so both pointers can land
 * on it), then any other packet files, then files added on this device.
 *
 * "Add a file" happens in the browser. validateUpload() checks the bytes; a PDF's
 * text is read with pdf.js and passed through the session's redactor; the
 * homeowner sees exactly what would be hidden (RedactionPreview) and chooses the
 * slot the file is for. Nothing guesses the slot. The list of added files is
 * owned by the editor (`addedFiles` / `onAddFile` / `onRemoveFile`), which may
 * send them with a live run; this component only ever hands it the REDACTED text.
 * The redactor session and the original text never leave this component, and it
 * makes no network calls itself.
 *
 * Animations:
 *   .anim-fade-up       (design lane) Cards enter, staggered 40ms apart via --stagger.
 *   .anim-pop           (design lane) A file the homeowner just added.
 *   .anim-slide-in-right (design lane) The add-a-file drawer slides in from the right.
 *   card state          Cards transition border/background/shadow over --dur-slow as
 *                       the run marks them; the pointed card lifts (stage.css).
 * Reduced motion: no stagger, slide or lift; state changes are instant.
 */
import { useId, useRef, useState, type CSSProperties } from "react";
import type { PacketFile } from "@/components/pointer/contract";
import type { AddedDocument } from "@/components/pointer/documents";
import { targetById, type Plan, type PlanDocument } from "@/components/pointer/plan";
import type { ItemState } from "@/components/pointer/run-state";
import { countByKind, createRedactor, RedactionPreview, validateUpload, type RedactionSpan, type Redactor, type UploadKind } from "@/lib/redact";
import { boardSummaries, declaredTypeForSlot, fileCards, formatBytes, slotGroups, type BoardSummary, type FileCard } from "./model";
import { extractPdfText } from "./pdfjs";

interface Props {
  plan: Plan;
  doc: PlanDocument;
  packet: PacketFile[];
  items: Record<string, ItemState>;
  planTargetId?: string;
  answerTargetId?: string;
  selectedTargetId?: string;
  onSelectTarget: (id: string) => void;
  /** Files added on this device (redacted), owned by the editor. */
  addedFiles: AddedDocument[];
  onAddFile: (doc: AddedDocument) => void;
  onRemoveFile: (id: string) => void;
}

export function FileBoard({
  plan,
  doc,
  packet,
  items,
  planTargetId,
  answerTargetId,
  selectedTargetId,
  onSelectTarget,
  addedFiles,
  onAddFile,
  onRemoveFile,
}: Props) {
  const cards = fileCards(plan, doc.id, packet, items);
  const summaries = boardSummaries(plan, doc.id, items);
  const [adding, setAdding] = useState(false);
  // One redactor per session: the same name gets the same token in every file.
  const [redactor] = useState(() => createRedactor());

  return (
    <div className="mx-auto w-full max-w-[880px]">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--fg)]">{doc.title}</h2>
          <p className="mt-0.5 text-[13px] text-[var(--fg-muted)]">
            {doc.made_up ? "A made-up applicant's files, for the demo. " : ""}Files stay on this device.
          </p>
        </div>
        <button type="button" className="stage-btn stage-btn-primary" onClick={() => setAdding(true)}>
          <PlusIcon />
          Add a file
        </button>
      </header>

      {summaries.map((sm) => (
        <SummaryRow
          key={sm.targetId}
          summary={sm}
          pointed={sm.targetId === planTargetId}
          answered={sm.targetId === answerTargetId}
          selected={sm.targetId === selectedTargetId}
          onSelect={onSelectTarget}
        />
      ))}

      <ul className="stage-file-grid" aria-label="Files">
        {cards.map((c, i) => (
          <li key={c.targetId ?? `file:${c.name}`} className="anim-fade-up" style={{ "--stagger": `${i * 40}ms` } as CSSProperties}>
            <FileCardView
              card={c}
              pointed={!!c.targetId && c.targetId === planTargetId}
              answered={!!c.targetId && c.targetId === answerTargetId}
              selected={!!c.targetId && c.targetId === selectedTargetId}
              onSelect={onSelectTarget}
            />
          </li>
        ))}
        {addedFiles.map((f) => (
          <li key={f.id} className="anim-pop">
            <AddedFileView file={f} slot={targetById(plan, f.slotId)?.label ?? f.slotId} onRemove={() => onRemoveFile(f.id)} />
          </li>
        ))}
      </ul>

      {adding && (
        <AddFileDrawer
          plan={plan}
          redactor={redactor}
          onClose={() => setAdding(false)}
          onAdd={(f) => {
            onAddFile(f);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

const STATUS_LABEL = { complete: "Complete", missing: "Missing", unknown: "Unclear" } as const;

function FileCardView({
  card,
  pointed,
  answered,
  selected,
  onSelect,
}: {
  card: FileCard;
  pointed: boolean;
  answered: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const body = (
    <>
      <span className="flex items-start gap-2.5">
        <FileIcon />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-[var(--fg)]">{card.name}</span>
          <span className="mt-0.5 block text-[12px] text-[var(--fg-muted)]">
            Declared type: <code className="stage-code">{card.declaredType}</code>
          </span>
        </span>
      </span>
      <span className="mt-3 flex items-center gap-2">
        {card.status ? (
          <span className="stage-label" data-status={card.status}>
            {STATUS_LABEL[card.status]}
          </span>
        ) : (
          <span className="stage-label">{card.targetId ? "Not checked yet" : "Not in the plan"}</span>
        )}
        {card.highlighted && <span className="stage-label" data-status="lawlens">Law Lens</span>}
      </span>
      {card.statusText && <span className="mt-2 block text-[12px] leading-snug text-[var(--fg-muted)]">{card.statusText}</span>}
    </>
  );
  if (!card.targetId) return <div className="stage-file-card" data-muted>{body}</div>;
  const id = card.targetId;
  return (
    <button
      type="button"
      data-target-id={id}
      className="stage-file-card"
      data-status={card.status}
      data-pointed={pointed || undefined}
      data-answer={answered || undefined}
      aria-pressed={selected}
      data-selected={selected || undefined}
      onClick={() => onSelect(id)}
    >
      {body}
    </button>
  );
}

/** A board-level target ("Your packet, all files"): a full-width row both pointers can land on. */
function SummaryRow({
  summary,
  pointed,
  answered,
  selected,
  onSelect,
}: {
  summary: BoardSummary;
  pointed: boolean;
  answered: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      data-target-id={summary.targetId}
      className="stage-file-card anim-fade-up mb-3 w-full"
      data-status={summary.status}
      data-pointed={pointed || undefined}
      data-answer={answered || undefined}
      aria-pressed={selected}
      data-selected={selected || undefined}
      onClick={() => onSelect(summary.targetId)}
    >
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-[var(--fg)]">{summary.label}</span>
        {summary.status ? (
          <span className="stage-label" data-status={summary.status}>
            {STATUS_LABEL[summary.status]}
          </span>
        ) : (
          <span className="stage-label">Not checked yet</span>
        )}
      </span>
      {summary.statusText && <span className="mt-1.5 block text-[12px] leading-snug text-[var(--fg-muted)]">{summary.statusText}</span>}
    </button>
  );
}

function AddedFileView({ file, slot, onRemove }: { file: AddedDocument; slot: string; onRemove: () => void }) {
  return (
    <div className="stage-file-card" data-added>
      <span className="flex items-start gap-2.5">
        <FileIcon />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-[var(--fg)]">{file.name}</span>
          <span className="mt-0.5 block text-[12px] text-[var(--fg-muted)]">
            {file.kind.toUpperCase()} · {formatBytes(file.size)} · for <strong className="font-medium text-[var(--fg)]">{slot}</strong>
          </span>
        </span>
      </span>
      <span className="mt-3 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="stage-label" data-status="added">
            On this device
          </span>
          {file.hidden > 0 && (
            <span className="truncate text-[12px] text-[var(--fg-muted)]">
              {file.hidden} detail{file.hidden === 1 ? "" : "s"} hidden
            </span>
          )}
        </span>
        <button type="button" className="stage-link shrink-0" onClick={onRemove} aria-label={`Remove ${file.name}`}>
          Remove
        </button>
      </span>
    </div>
  );
}

type Draft =
  | { step: "pick" }
  | { step: "reading"; name: string }
  | { step: "error"; reason: string }
  | {
      step: "review";
      name: string;
      kind: UploadKind;
      size: number;
      original: string;
      redacted: string;
      spans: RedactionSpan[];
      note?: string;
    };

/**
 * The add-a-file drawer (a modal <dialog>): choose a file, see what would be hidden,
 * pick the slot it is for. The extracted text lives only in this component's state
 * and is dropped when the drawer closes.
 */
function AddFileDrawer({
  plan,
  redactor,
  onClose,
  onAdd,
}: {
  plan: Plan;
  redactor: Redactor;
  onClose: () => void;
  onAdd: (f: AddedDocument) => void;
}) {
  const titleId = useId();
  const slotId = useId();
  const [draft, setDraft] = useState<Draft>({ step: "pick" });
  const [slot, setSlot] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const groups = slotGroups(plan);

  const dialogRef = (el: HTMLDialogElement | null) => {
    if (el && !el.open) el.showModal?.();
  };

  async function choose(file: File | undefined) {
    if (!file) return;
    setDraft({ step: "reading", name: file.name });
    const check = await validateUpload(file);
    if (!check.ok) return setDraft({ step: "error", reason: check.reason });
    let original = "";
    let note: string | undefined;
    if (check.kind === "pdf") {
      try {
        const out = await extractPdfText(await file.arrayBuffer());
        original = out.text;
        if (!original) note = "This PDF has no readable text (it may be a scan), so there is nothing to hide.";
        else if (out.truncated) note = `Showing the first part of a ${out.pages}-page PDF.`;
      } catch {
        return setDraft({ step: "error", reason: "This PDF could not be read. It may be damaged or password-protected." });
      }
    } else {
      note = "Pictures are not read for text in this preview, so there is nothing to hide.";
    }
    const r = redactor.redact(original);
    setDraft({ step: "review", name: check.safeName, kind: check.kind, size: check.size, original, redacted: r.text, spans: r.spans, note });
  }

  const hidden = draft.step === "review" ? Object.values(countByKind(draft.spans)).reduce((a, b) => a + b, 0) : 0;

  return (
    <dialog
      ref={dialogRef}
      className="stage-drawer anim-slide-in-right"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose(); // backdrop click
      }}
    >
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
          <h2 id={titleId} className="text-base font-semibold">
            Add a file
          </h2>
          <button type="button" className="stage-icon-btn" aria-label="Close" onClick={onClose}>
            <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm">
          <p className="text-[var(--fg-muted)]">
            PDF, PNG or JPEG, up to 10 MB. Your file is read here in your browser and is not uploaded. Before anything
            from it could be shared, names, addresses, phone numbers, emails and parcel numbers are hidden. You will see
            exactly what.
          </p>

          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              void choose(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button type="button" className="stage-dropzone mt-4" onClick={() => inputRef.current?.click()}>
            <FileIcon />
            <span>{draft.step === "pick" || draft.step === "error" ? "Choose a file" : "Choose a different file"}</span>
          </button>

          <div aria-live="polite" className="mt-4">
            {draft.step === "reading" && <p className="text-[var(--fg-muted)]">Reading {draft.name}…</p>}
            {draft.step === "error" && (
              <p role="alert" className="rounded-[var(--radius-sm)] border border-[var(--danger)] bg-[var(--danger-subtle)] px-3 py-2 text-[var(--danger)]">
                {draft.reason}
              </p>
            )}
            {draft.step === "review" && (
              <div className="anim-fade-up">
                <p className="font-semibold text-[var(--fg)]">
                  {draft.name} <span className="font-normal text-[var(--fg-muted)]">· {formatBytes(draft.size)}</span>
                </p>
                {draft.note && <p className="mt-1 text-[var(--fg-muted)]">{draft.note}</p>}
                {draft.original && (
                  <RedactionPreview className="mt-3" original={draft.original} redacted={draft.redacted} spans={draft.spans} title="What would be hidden" afterLabel="After (what Pointer would share if you ask it about this file)" />
                )}
              </div>
            )}
          </div>
        </div>

        <footer className="border-t border-[var(--border)] px-5 py-3">
          <label htmlFor={slotId} className="block text-[13px] font-semibold text-[var(--fg)]">
            Which item is this file for?
          </label>
          <select
            id={slotId}
            className="stage-select mt-1.5 w-full"
            value={slot}
            disabled={draft.step !== "review"}
            onChange={(e) => setSlot(e.target.value)}
          >
            <option value="">Choose an item…</option>
            {groups.map((g) => (
              <optgroup key={g.docId} label={g.title}>
                {g.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="stage-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="stage-btn stage-btn-primary"
              disabled={draft.step !== "review" || !slot}
              onClick={() =>
                draft.step === "review" &&
                onAdd({
                  id: `${Date.now()}-${draft.name}`,
                  name: draft.name,
                  slotId: slot,
                  declared_type: declaredTypeForSlot(plan, slot),
                  kind: draft.kind,
                  size: draft.size,
                  // Only the redacted text leaves this drawer; the original stays here and is dropped on close.
                  text: draft.redacted,
                  hidden,
                })
              }
            >
              Add to my files
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}

function FileIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="mt-0.5 shrink-0 text-[var(--fg-muted)]">
      <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z" />
    </svg>
  );
}
