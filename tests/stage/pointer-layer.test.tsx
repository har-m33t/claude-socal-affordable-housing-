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
  it("lands the plan fingertip on its target, from the target id alone", async () => {
    const { container } = render(<Stage {...base} />);
    await settle();
    const plan = anchor(container, "plan")!;
    expect(plan.dataset.shown).toBe("true");
    expect(plan.style.transform).toBe("translate3d(124px, 227.5px, 0px)");
    expect(plan.textContent).toContain("Step 2 of 4");
    expect(plan.querySelector("[aria-hidden]")).not.toBeNull();
    expect(anchor(container, "answer")).toBeNull();
  });

  it("draws a second, outlined answer hand with a Back button, and scrolls to it", async () => {
    const onBack = vi.fn();
    const { container, getByRole } = render(<Stage {...base} answerTargetId="b" onBackToStep={onBack} />);
    await settle();
    const answer = anchor(container, "answer")!;
    expect(answer.dataset.shown).toBe("true");
    expect(answer.style.transform).toBe("translate3d(124px, 922px, 0px)");
    expect(answer.querySelector('.stage-hand[data-variant="answer"]')).not.toBeNull();
    expect(answer.textContent).toContain("Your question");
    expect(Element.prototype.scrollTo).toHaveBeenCalled();
    fireEvent.click(getByRole("button", { name: /back to my step/i }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("fades the answer hand where it is when the answer is cleared", async () => {
    const { container, rerender } = render(<Stage {...base} answerTargetId="b" />);
    await settle();
    rerender(<Stage {...base} />);
    await settle();
    const answer = anchor(container, "answer")!;
    expect(answer.dataset.shown).toBeUndefined();
    expect(answer.style.transform).toBe("translate3d(124px, 922px, 0px)");
  });

  it("pulses the plan hand instead of drawing a second hand on the same spot", async () => {
    const { container } = render(<Stage {...base} pulsePlan />);
    await settle();
    expect(container.querySelector(".stage-tip-ring.anim-pulse-ring")).not.toBeNull();
    expect(anchor(container, "answer")).toBeNull();
  });

  it("shows nothing while its pane is hidden", async () => {
    const { container } = render(<Stage {...base} active={false} answerTargetId="b" />);
    await settle();
    expect(container.querySelector(".stage-anchor[data-shown]")).toBeNull();
  });
});
