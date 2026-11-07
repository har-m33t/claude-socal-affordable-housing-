"use client";

/**
 * Animated pointing hand. Its fingertip is at (TIP_X, TIP_Y) in its own coordinates, so
 * placing it at (x, y) puts the fingertip exactly on the target. The parent sets the position;
 * a CSS transform transition does the movement. `tapKey` restarts the tap animation on arrival.
 */
export const TIP_X = 15;
export const TIP_Y = 2;

export function PointerHand({ x, y, visible, tapKey }: { x: number; y: number; visible: boolean; tapKey: string | number }) {
  return (
    <div
      aria-hidden
      className="pointer-hand pointer-events-none absolute left-0 top-0 z-30"
      style={{
        transform: `translate(${x - TIP_X}px, ${y - TIP_Y}px)`,
        opacity: visible ? 1 : 0,
      }}
    >
      <div key={tapKey} className="pointer-hand-tap">
        <svg width="46" height="58" viewBox="0 0 46 58" fill="none" xmlns="http://www.w3.org/2000/svg">
          <g filter="url(#hand-shadow)">
            {/* index finger */}
            <rect x="10" y="1" width="10" height="30" rx="5" fill="var(--color-paper)" stroke="var(--color-terracotta)" strokeWidth="2" />
            {/* folded fingers */}
            <rect x="19" y="18" width="9" height="16" rx="4.5" fill="var(--color-paper)" stroke="var(--color-terracotta)" strokeWidth="2" />
            <rect x="26.5" y="20" width="9" height="15" rx="4.5" fill="var(--color-paper)" stroke="var(--color-terracotta)" strokeWidth="2" />
            <rect x="34" y="23" width="8.5" height="13" rx="4.25" fill="var(--color-paper)" stroke="var(--color-terracotta)" strokeWidth="2" />
            {/* palm */}
            <path
              d="M10 26 C 6 30, 4 34, 5 40 C 6 48, 12 55, 22 55 L 32 55 C 39 55, 43 49, 43 42 L 43 31 L 10 31 Z"
              fill="var(--color-paper)"
              stroke="var(--color-terracotta)"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            {/* thumb */}
            <path d="M10 33 C 5 31, 1 33, 2 37 C 3 40, 8 43, 13 44" fill="var(--color-paper)" stroke="var(--color-terracotta)" strokeWidth="2" strokeLinecap="round" />
            {/* cuff */}
            <rect x="15" y="51" width="24" height="6" rx="2" fill="var(--color-terracotta)" />
          </g>
          <defs>
            <filter id="hand-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="1" dy="2" stdDeviation="1.5" floodColor="#3b2a20" floodOpacity="0.25" />
            </filter>
          </defs>
        </svg>
      </div>
    </div>
  );
}
