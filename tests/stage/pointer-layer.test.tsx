// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PointerLayer, type PointerLayerProps } from "@/components/stage/PointerLayer";

// jsdom has no layout: give targets fixed viewport rects, keyed by data-target-id.
const RECTS: Record<string, [number, number, number, number]> = {
  a: [100, 200, 400, 50],
  b: [100, 900, 400, 40],
};

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const r = RECTS[this.dataset.targetId ?? ""] ?? [0, 0, 800, 600];
    const [left, top, width, height] = r;
    return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON() {} } as DOMRect;
  });
  Element.prototype.scrollTo = vi.fn() as unknown as Element["scrollTo"];
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type LayerProps = Omit<PointerLayerProps, "containerRef">;

function Stage(props: LayerProps) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref}>
      <div>
        <button data-target-id="a" />
        <button data-target-id="b" />
      </div>
      <PointerLayer containerRef={ref} {...props} />
    </div>
  );
}

const base: LayerProps = { active: true, planTargetId: "a", planLabel: "Step 2 of 4", pulsePlan: false, tapKey: 1, onBackToStep: () => {} };

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
}

const anchor = (c: HTMLElement, v: string) => c.querySelector<HTMLElement>(`.stage-anchor[data-variant="${v}"]`);

describe("PointerLayer", () => {
  it("lands the plan cursor tip on its target, from the target id alone", async () => {
    const { container } = render(<Stage {...base} />);
    await settle();
    const plan = anchor(container, "plan")!;
    expect(plan.dataset.shown).toBe("true");
    expect(plan.style.transform).toBe("translate3d(124px, 227.5px, 0px)");
    expect(plan.textContent).toContain("Step 2 of 4");
    expect(plan.querySelector("[aria-hidden]")).not.toBeNull();
    expect(anchor(container, "answer")).toBeNull();
  });

  it("draws the plan cursor solid and the answer cursor outlined with a ? badge, each with its own shadow filter", async () => {
    const { container } = render(<Stage {...base} answerTargetId="b" />);
    await settle();
    const plan = anchor(container, "plan")!.querySelector("svg")!;
    const answer = anchor(container, "answer")!.querySelector("svg")!;
    expect(plan.querySelector("path")!.getAttribute("fill")).toBe("var(--plan)");
    expect(plan.querySelector("text")).toBeNull();
    expect(answer.querySelectorAll("path")[1].getAttribute("stroke")).toBe("var(--answer)");
    expect(answer.querySelector("text")!.textContent).toBe("?");
    const ids = [...container.querySelectorAll("filter")].map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("draws a second, outlined answer cursor with a Back button, and scrolls to it", async () => {
    const onBack = vi.fn();
    const { container, getByRole } = render(<Stage {...base} answerTargetId="b" onBackToStep={onBack} />);
    await settle();
    const answer = anchor(container, "answer")!;
    expect(answer.dataset.shown).toBe("true");
    expect(answer.style.transform).toBe("translate3d(124px, 922px, 0px)");
    expect(answer.querySelector('.stage-cursor[data-variant="answer"]')).not.toBeNull();
    expect(answer.textContent).toContain("Your question");
    expect(Element.prototype.scrollTo).toHaveBeenCalled();
    fireEvent.click(getByRole("button", { name: /back to my step/i }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("fades the answer cursor where it is when the answer is cleared", async () => {
    const { container, rerender } = render(<Stage {...base} answerTargetId="b" />);
    await settle();
    rerender(<Stage {...base} />);
    await settle();
    const answer = anchor(container, "answer")!;
    expect(answer.dataset.shown).toBeUndefined();
    expect(answer.style.transform).toBe("translate3d(124px, 922px, 0px)");
  });

  it("pulses the plan cursor instead of drawing a second cursor on the same spot", async () => {
    const { container } = render(<Stage {...base} pulsePlan />);
    await settle();
    expect(container.querySelector(".stage-tip-ring.anim-pulse-ring")).not.toBeNull();
    expect(anchor(container, "answer")).toBeNull();
  });

  it("re-measures when an animation in the document ends (transforms move targets without resizing)", async () => {
    RECTS.a = [100, 206, 400, 50]; // measured mid fade-up: 6px below where it settles
    try {
      const { container } = render(<Stage {...base} />);
      await settle();
      expect(anchor(container, "plan")!.style.transform).toBe("translate3d(124px, 233.5px, 0px)");
      RECTS.a = [100, 200, 400, 50];
      fireEvent.animationEnd(container.querySelector('[data-target-id="a"]')!);
      await settle();
      expect(anchor(container, "plan")!.style.transform).toBe("translate3d(124px, 227.5px, 0px)");
    } finally {
      RECTS.a = [100, 200, 400, 50];
    }
  });

  it("shows nothing while its pane is hidden", async () => {
    const { container } = render(<Stage {...base} active={false} answerTargetId="b" />);
    await settle();
    expect(container.querySelector(".stage-anchor[data-shown]")).toBeNull();
  });
});
