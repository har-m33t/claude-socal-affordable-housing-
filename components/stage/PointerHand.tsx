"use client";
import { useId } from "react";
/**
 * The two pointing hands. They differ in shape, not just colour, so nobody has to
 * tell terracotta from blue:
 *   - variant "plan":   a SOLID terracotta hand (--plan) with a filled label chip
 *                       ("Step 4 of 12"). It stays on the current step.
 *   - variant "answer": an OUTLINED blue hand (--answer) with a "?" badge and an
 *                       outlined chip ("Your question"). It shows where an answer is.
 *
 * The fingertip is at (TIP_X, TIP_Y) in the SVG's own coordinates. The parent
 * anchor sits exactly on the target point; this body is offset by -TIP so the
 * fingertip lands on it. Purely decorative: aria-hidden, never takes clicks.
 *
 * Animations (keyframes in stage.css unless noted):
 *   stage-hand-tap  Tap on arrival: scale 1 -> 0.86 (+2px down) -> 1 around the
 *                   fingertip, 420ms ease-out, delayed by --dur-pointer so it
 *                   lands after the glide. Restarts when `tapKey` changes.
 *   .anim-pop       (design lane utility) Entrance when a hand appears in place.
 *   .anim-pulse-ring (design lane utility) On the ring around the fingertip when
 *                   `pulse` is set: the answer is the current step, so the plan
 *                   hand pulses instead of a second hand appearing.
 * Reduced motion: no tap, no pop, no pulse; the ring stays as a static outline.
 */
export const TIP_X = 15;
export const TIP_Y = 2;

export type HandVariant = "plan" | "answer";

export function PointerHand({
  variant,
  label,
  tapKey,
  pulse = false,
  flip = false,
}: {
  variant: HandVariant;
  label: string;
  tapKey: string | number;
  pulse?: boolean;
  /** Put the label chip on the left of the hand (near the right edge of the page). */
  flip?: boolean;
}) {
  return (
    <div aria-hidden className="stage-hand anim-pop" data-variant={variant} data-flip={flip || undefined}>
      {pulse && <span className="stage-tip-ring anim-pulse-ring" />}
      <div key={tapKey} className="stage-hand-tap">
        {variant === "plan" ? <SolidHand /> : <OutlinedHand />}
      </div>
      <span className="stage-hand-chip">{label}</span>
    </div>
  );
}

// Shared silhouette: index finger up (tip at 15,1), three folded fingers, palm, thumb, cuff.
const FINGER = { x: 10, y: 1, width: 10, height: 30, rx: 5 };
const FOLDED = [
  { x: 19, y: 18, width: 9, height: 16, rx: 4.5 },
  { x: 26.5, y: 20, width: 9, height: 15, rx: 4.5 },
  { x: 34, y: 23, width: 8.5, height: 13, rx: 4.25 },
];
const PALM = "M10 26 C 6 30, 4 34, 5 40 C 6 48, 12 55, 22 55 L 32 55 C 39 55, 43 49, 43 42 L 43 31 L 10 31 Z";
const THUMB = "M10 33 C 5 31, 1 33, 2 37 C 3 40, 8 43, 13 44";

function Shadow({ id }: { id: string }) {
  return (
    <defs>
      <filter id={id} x="-25%" y="-20%" width="150%" height="150%">
        <feDropShadow dx="0.5" dy="2" stdDeviation="1.6" floodColor="#1f2328" floodOpacity="0.28" />
      </filter>
    </defs>
  );
}

/** Plan hand: solid terracotta, white seams between the fingers. */
function SolidHand() {
  // Unique per instance: every document pane mounts a pointer layer, and a duplicated
  // filter id resolves to the first copy, which may sit in a hidden pane and blank the hand.
  const shadowId = `hand-shadow-${useId().replace(/:/g, "")}`;
  const seam = { fill: "var(--plan)", stroke: "var(--bg)", strokeWidth: 1.6, strokeLinejoin: "round" as const };
  return (
    <svg width="52" height="60" viewBox="0 0 52 60" fill="none">
      <g filter={`url(#${shadowId})`}>
        <rect {...FINGER} {...seam} />
        {FOLDED.map((r, i) => (
          <rect key={i} {...r} {...seam} />
        ))}
        <path d={PALM} {...seam} />
        <path d={THUMB} {...seam} strokeLinecap="round" />
        <rect x="15" y="51" width="24" height="6.5" rx="2" fill="var(--bg)" stroke="var(--plan)" strokeWidth="1.6" />
      </g>
      <Shadow id={shadowId} />
    </svg>
  );
}

/** Answer hand: white fill, blue outline, and a "?" badge off the top-right knuckle. */
function OutlinedHand() {
  const shadowId = `hand-shadow-${useId().replace(/:/g, "")}`;
  const line = { fill: "var(--bg)", stroke: "var(--answer)", strokeWidth: 2, strokeLinejoin: "round" as const };
  return (
    <svg width="52" height="60" viewBox="0 0 52 60" fill="none">
      <g filter={`url(#${shadowId})`}>
        <rect {...FINGER} {...line} />
        {FOLDED.map((r, i) => (
          <rect key={i} {...r} {...line} />
        ))}
        <path d={PALM} {...line} />
        <path d={THUMB} {...line} strokeLinecap="round" />
        <rect x="15" y="51" width="24" height="6.5" rx="2" fill="var(--answer)" />
        <circle cx="42" cy="11" r="8.5" fill="var(--answer)" stroke="var(--bg)" strokeWidth="2" />
        <text x="42" y="15.2" textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--bg)" fontFamily="system-ui, sans-serif">
          ?
        </text>
      </g>
      <Shadow id={shadowId} />
    </svg>
  );
}
