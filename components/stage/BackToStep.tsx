"use client";
/**
 * "Back to my step": dismisses the answer pointer and returns to the plan
 * pointer's document. Two placements, same action:
 *   - "floating": a small pill under the answer hand's label (the one interactive
 *     thing on the pointer layer, so it re-enables pointer events for itself).
 *   - "banner":   a strip across the top of the stage, shown when the answer is on
 *     another document or page than the homeowner's step.
 *
 * Animations:
 *   .anim-fade-up (design lane utility) Entrance of both placements.
 * Reduced motion: the utility itself drops to an instant appearance.
 */
export function BackToStep({
  placement,
  where,
  onBack,
}: {
  placement: "floating" | "banner";
  /** For the banner: where the answer is, e.g. "ADU Checklist, page 2". */
  where?: string;
  onBack: () => void;
}) {
  if (placement === "floating") {
    return (
      <button type="button" className="stage-back-pill anim-fade-up" onClick={onBack}>
        <BackArrow />
        Back to my step
      </button>
    );
  }
  return (
    <div className="stage-back-banner anim-fade-up" role="status">
      <span className="stage-back-banner-q" aria-hidden>
        ?
      </span>
      <p className="min-w-0 flex-1 truncate">
        Showing the answer to your question{where ? <> on <strong className="font-semibold">{where}</strong></> : null}.
      </p>
      <button type="button" className="stage-back-banner-btn" onClick={onBack}>
        <BackArrow />
        Back to my step
      </button>
    </div>
  );
}

function BackArrow() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M7.78 12.53a.75.75 0 0 1-1.06 0L2.47 8.28a.75.75 0 0 1 0-1.06l4.25-4.25a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L4.81 7h7.44a.75.75 0 0 1 0 1.5H4.81l2.97 2.97a.75.75 0 0 1 0 1.06Z" />
    </svg>
  );
}
