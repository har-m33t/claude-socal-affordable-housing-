// Pure geometry for the pointer layer. No React, no DOM writes: easy to unit test.
//
// Every pointable thing on the stage (a PDF overlay box, a file-board card) is an
// element carrying `data-target-id`. The pointer layer finds that element, measures
// it relative to the scroll container's *content* (so the result does not change
// when the user scrolls), and turns the rect into the point the cursor tip lands on.

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

type ClientRect = Pick<DOMRect, "left" | "top" | "width" | "height">;

/**
 * `el`'s rect in the coordinate space of `container`'s scrollable content:
 * viewport rect minus the container's viewport origin, plus its scroll offset.
 */
export function contentRect(el: ClientRect, container: ClientRect, scroll: { left: number; top: number }): Rect {
  return {
    left: el.left - container.left + scroll.left,
    top: el.top - container.top + scroll.top,
    width: el.width,
    height: el.height,
  };
}

/**
 * Where the cursor's arrow tip (its hotspot) lands on a target: just inside its
 * left edge, a little below the middle, so the cursor and its label (which hang
 * down and to the right of the tip) cover as little of the target's text as possible.
 */
export function tipPoint(r: Rect): Point {
  return { x: r.left + Math.min(r.width * 0.06, 28), y: r.top + r.height * 0.55 };
}

/**
 * Scroll offset that brings `r` into a comfortable reading position: its top a
 * third of the way down the viewport, clamped to the scrollable range.
 */
export function scrollTopFor(r: Rect, viewportHeight: number, scrollHeight: number): number {
  const ideal = r.top + r.height / 2 - viewportHeight / 3;
  return Math.round(Math.max(0, Math.min(ideal, scrollHeight - viewportHeight)));
}

/** True when `r` is fully inside the visible band [scrollTop, scrollTop + viewportHeight]. */
export function isInView(r: Rect, scrollTop: number, viewportHeight: number, margin = 24): boolean {
  return r.top >= scrollTop + margin && r.top + r.height <= scrollTop + viewportHeight - margin;
}

/**
 * The element for a target id inside `root`. Compares `dataset` rather than
 * building a selector, so ids never need escaping.
 */
export function findTargetElement(root: ParentNode, id: string): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>("[data-target-id]")) {
    if (el.dataset.targetId === id) return el;
  }
  return null;
}

export function samePoint(a: Point | null, b: Point | null): boolean {
  return a === b || (!!a && !!b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5);
}
