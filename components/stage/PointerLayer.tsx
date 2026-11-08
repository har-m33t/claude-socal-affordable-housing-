"use client";
/**
 * The one place pointers are positioned, for every kind of document.
 *
 * Contract with the document: each pointable thing renders an element with
 * `data-target-id`. This layer lives inside the document's scroll container
 * (which must be `position: relative`), so it scrolls with the content for free.
 * To place a cursor it:
 *   1. finds the element for the target id (geometry.findTargetElement),
 *   2. measures it relative to the scroll content (contentRect: viewport rect
 *      minus container origin plus scroll offset, so scrolling never moves it),
 *   3. converts the rect to the tip point (tipPoint, the arrow's hotspot) and
 *      sets a CSS transform on the cursor's anchor.
 * It re-measures, at most once per animation frame, whenever layout can change:
 * the container or its content resizes (ResizeObserver; covers PDF pages
 * rendering and window/sidebar width changes), target elements mount or unmount
 * (MutationObserver), the window resizes, or an animation/transition inside the
 * document ends (transforms such as the pane's fade-up move targets without
 * resizing anything, so measuring mid-animation would leave the tip off by the
 * remaining offset). Pointers only ever receive ids.
 *
 * When the focused target changes (the answer if there is one, else the plan
 * step) and it is not comfortably in view, the container scrolls it into view.
 *
 * Animations (keyframes and transitions in stage.css):
 *   glide       The anchor's `transform` transitions over --dur-pointer with
 *               --ease-out, so a cursor glides from target to target on its document.
 *   fade        `opacity` over --dur-slow when a cursor is dismissed; it fades where it is.
 *   appear      A cursor that was hidden (first show, tab switch, new answer) does not
 *               glide in from its old spot: its anchor remounts at the target and
 *               plays .anim-pop (see PointerCursor).
 *   smooth scroll  `scrollTo({ behavior: "smooth" })` to bring the target into view.
 * Reduced motion: no glide (cursors jump), scroll is instant, fades stay short.
 */
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { BackToStep } from "./BackToStep";
import { contentRect, findTargetElement, tipPoint, isInView, samePoint, scrollTopFor, type Point, type Rect } from "./geometry";
import { PointerCursor, type CursorVariant } from "./PointerCursor";

export interface PointerLayerProps {
  /** The document's scroll container. Must be position: relative and contain the target elements. */
  containerRef: RefObject<HTMLElement | null>;
  /** False while this document's pane is hidden: cursors hide and nothing is measured. */
  active: boolean;
  planTargetId?: string;
  planLabel: string;
  /** Pulse the plan cursor: the homeowner's question is answered by the current step. */
  pulsePlan: boolean;
  tapKey: number;
  answerTargetId?: string;
  onBackToStep: () => void;
}

interface Layout {
  plan: Rect | null;
  answer: Rect | null;
  width: number;
}

const EMPTY: Layout = { plan: null, answer: null, width: 0 };
/** Room the cursor plus its name tag (and the Back button) need to the right of the tip. */
const CHIP_ROOM = 190;

function sameRect(a: Rect | null, b: Rect | null): boolean {
  return a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function PointerLayer({
  containerRef,
  active,
  planTargetId,
  planLabel,
  pulsePlan,
  tapKey,
  answerTargetId,
  onBackToStep,
}: PointerLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout>(EMPTY);
  const pendingScroll = useRef<string | undefined>(undefined);

  const measure = useEffectEvent(() => {
    const c = containerRef.current;
    if (!c || !active) return;
    const origin = c.getBoundingClientRect();
    const scroll = { left: c.scrollLeft, top: c.scrollTop };
    const rectOf = (id: string | undefined): Rect | null => {
      const el = id ? findTargetElement(c, id) : null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width || r.height ? contentRect(r, origin, scroll) : null;
    };
    const next: Layout = { plan: rectOf(planTargetId), answer: rectOf(answerTargetId), width: c.clientWidth };
    setLayout((prev) =>
      sameRect(prev.plan, next.plan) && sameRect(prev.answer, next.answer) && prev.width === next.width ? prev : next,
    );

    // Bring the focused target into view once it can be measured.
    const want = pendingScroll.current;
    const rect = want === answerTargetId ? next.answer : want === planTargetId ? next.plan : null;
    if (want && rect) {
      pendingScroll.current = undefined;
      if (!isInView(rect, c.scrollTop, c.clientHeight)) {
        c.scrollTo({ top: scrollTopFor(rect, c.clientHeight, c.scrollHeight), behavior: prefersReducedMotion() ? "auto" : "smooth" });
      }
    }
  });

  const frame = useRef(0);
  const schedule = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      measure();
    });
  }, []);

  // Watch for anything that can move a target while this pane is on screen.
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    if (!active) {
      // Forget positions measured before the pane was hidden; they may be stale on return.
      setLayout(EMPTY);
      return;
    }
    schedule();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    ro?.observe(c);
    if (c.firstElementChild) ro?.observe(c.firstElementChild);
    const mo = new MutationObserver((records) => {
      // Our own cursors mounting is not a layout change worth measuring for.
      if (records.some((r) => !layerRef.current?.contains(r.target))) schedule();
    });
    mo.observe(c, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-target-id"] });
    window.addEventListener("resize", schedule);
    // Our own cursors' animations (pop, tap, ripple) never move a target.
    const settled = (e: Event) => {
      if (!layerRef.current?.contains(e.target as Node)) schedule();
    };
    c.addEventListener("animationend", settled);
    c.addEventListener("transitionend", settled);
    return () => {
      ro?.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", schedule);
      c.removeEventListener("animationend", settled);
      c.removeEventListener("transitionend", settled);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [containerRef, active, schedule]);

  // The focused target: the answer while there is one, otherwise the step.
  const focusId = answerTargetId ?? planTargetId;
  useLayoutEffect(() => {
    pendingScroll.current = active ? focusId : undefined;
    schedule();
  }, [focusId, active, schedule]);
  useLayoutEffect(schedule, [planTargetId, answerTargetId, schedule]);

  const planPoint = active && layout.plan ? tipPoint(layout.plan) : null;
  const answerPoint = active && layout.answer ? tipPoint(layout.answer) : null;
  const flip = (p: Point | null) => !!p && layout.width > 0 && p.x + CHIP_ROOM > layout.width;

  return (
    <div ref={layerRef} className="stage-pointer-layer">
      <CursorAnchor point={planPoint} variant="plan">
        <PointerCursor variant="plan" label={planLabel} tapKey={tapKey} pulse={pulsePlan} flip={flip(planPoint)} />
      </CursorAnchor>
      <CursorAnchor point={answerPoint} variant="answer">
        <PointerCursor variant="answer" label="Your question" tapKey={answerTargetId ?? ""} flip={flip(answerPoint)} />
        <div className="stage-back-anchor" data-flip={flip(answerPoint) || undefined}>
          <BackToStep placement="floating" onBack={onBackToStep} />
        </div>
      </CursorAnchor>
    </div>
  );
}

/**
 * Holds a cursor on a point. While visible, moves glide (CSS transition). When the
 * cursor goes away it fades out where it was; when it comes back it remounts (new
 * key) at the new point, so it appears in place instead of gliding across the page.
 */
function CursorAnchor({ point, variant, children }: { point: Point | null; variant: CursorVariant; children: ReactNode }) {
  const showing = point !== null;
  const [state, setState] = useState<{ showing: boolean; visit: number; last: Point | null }>({
    showing,
    visit: 0,
    last: point,
  });
  // Derive from the previous render (React's "storing information from previous renders" pattern).
  if (state.showing !== showing || (showing && !samePoint(state.last, point))) {
    setState({ showing, visit: showing && !state.showing ? state.visit + 1 : state.visit, last: showing ? point : state.last });
  }
  const at = showing ? point : state.last;
  if (!at) return null;
  return (
    <div
      key={state.visit}
      className="stage-anchor"
      data-variant={variant}
      data-shown={showing || undefined}
      style={{ transform: `translate3d(${at.x}px, ${at.y}px, 0)` }}
    >
      {children}
    </div>
  );
}
