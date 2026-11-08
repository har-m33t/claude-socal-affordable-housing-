"use client";
import { useId } from "react";
/**
 * The two on-screen pointers, drawn as multiplayer collaborator cursors (the
 * arrow-plus-name-tag look of GitHub's homepage product demo). They differ in
 * shape and label, not just colour, so nobody has to tell terracotta from blue:
 *   - variant "plan":   a SOLID terracotta arrow (--plan) with a filled name tag
 *                       ("Step 4 of 13"). It stays on the current step.
 *   - variant "answer": an OUTLINED arrow (white fill, 2px --answer stroke) with a
 *                       "?" badge at its tail and an outlined name tag
 *                       ("Your question"). It shows where an answer is.
 * Both arrows carry a white outer outline and a soft shadow so they read on any page.
 *
 * Hotspot: the arrow tip is at (TIP_X, TIP_Y) in the SVG's viewBox (3.6px, 2.4px on screen). The
 * parent anchor sits exactly on the target point and this component is laid out
 * from that point (a zero-size box at the tip), so the tip lands on the target.
 * Purely decorative: aria-hidden, never takes clicks. The homeowner's own mouse
 * cursor is the system cursor; these never replace it.
 *
 * Animations (keyframes in stage.css unless noted):
 *   stage-cursor-tap     Click on arrival: scale 1 -> 0.92 -> 1 around the tip,
 *                        360ms ease-out, delayed by --dur-pointer so it lands after
 *                        the glide. Restarts when `tapKey` changes.
 *   stage-cursor-ripple  With the tap, a small ring grows from the tip and fades
 *                        (0 -> 26px, 520ms ease-out, same delay).
 *   .anim-pop            (design lane utility) Entrance when a cursor appears in place.
 *   .anim-pulse-ring     (design lane utility) Rings around the tip when `pulse` is
 *                        set: the answer is the current step, so the plan cursor
 *                        pulses instead of a second cursor appearing.
 * Reduced motion: no tap, ripple or pop; the pulse ring stays as a static outline.
 */
export const TIP_X = 3;
export const TIP_Y = 2;
/** Drawn at 1.2x its 24x30 viewBox, so on screen the tip is at (TIP_X, TIP_Y) * SCALE. */
export const SCALE = 1.2;

export type CursorVariant = "plan" | "answer";

// Classic arrow cursor with a tail, tip at (TIP_X, TIP_Y). Rounded joins soften the corners.
const ARROW = "M3 2 L3 20 L7.6 15.9 L10.6 22.6 L13.7 21.3 L10.8 14.7 L17 14.6 Z";

export function PointerCursor({
  variant,
  label,
  tapKey,
  pulse = false,
  flip = false,
}: {
  variant: CursorVariant;
  label: string;
  tapKey: string | number;
  pulse?: boolean;
  /** Put the name tag on the left of the tip (near the right edge of the page). */
  flip?: boolean;
}) {
  // Unique per instance: every document pane mounts a pointer layer, and a duplicated
  // filter id resolves to the first copy, which may sit in a hidden pane and blank the cursor.
  const shadowId = `cursor-shadow-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <div aria-hidden className="stage-cursor anim-pop" data-variant={variant} data-flip={flip || undefined}>
      {pulse && <span className="stage-tip-ring anim-pulse-ring" />}
      <div key={tapKey} className="stage-cursor-tap">
        <span className="stage-cursor-ripple" />
        <svg className="stage-cursor-arrow" width={24 * SCALE} height={30 * SCALE} viewBox="0 0 24 30" fill="none">
          <defs>
            <filter id={shadowId} x="-40%" y="-30%" width="180%" height="170%" colorInterpolationFilters="sRGB">
              <feDropShadow dx="0" dy="1.5" stdDeviation="1.4" floodColor="#1f2328" floodOpacity="0.32" />
            </filter>
          </defs>
          {variant === "plan" ? (
            // Solid: white outline drawn under the fill (paint-order) = 1.5px of white outside.
            <path d={ARROW} filter={`url(#${shadowId})`} fill="var(--plan)" stroke="#fff" strokeWidth="3" strokeLinejoin="round" paintOrder="stroke" />
          ) : (
            <g filter={`url(#${shadowId})`}>
              {/* Outlined: a white halo under a 2px blue stroke, then the "?" badge at the tail. */}
              <path d={ARROW} fill="#fff" stroke="#fff" strokeWidth="5" strokeLinejoin="round" />
              <path d={ARROW} fill="var(--bg)" stroke="var(--answer)" strokeWidth="2" strokeLinejoin="round" />
              <circle cx="17.5" cy="23.5" r="5.25" fill="var(--answer)" stroke="#fff" strokeWidth="1.5" />
              <text x="17.5" y="26.6" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#fff" fontFamily="system-ui, sans-serif">
                ?
              </text>
            </g>
          )}
        </svg>
      </div>
      <span className="stage-cursor-label">{label}</span>
    </div>
  );
}
