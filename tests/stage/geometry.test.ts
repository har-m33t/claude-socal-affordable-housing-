import { describe, expect, it } from "vitest";
import { contentRect, tipPoint, isInView, samePoint, scrollTopFor } from "@/components/stage/geometry";

describe("stage geometry", () => {
  it("measures a target in scroll-content space, independent of scroll", () => {
    const container = { left: 40, top: 100, width: 800, height: 600 };
    // Same element before and after scrolling 300px: viewport top moves, content top does not.
    const a = contentRect({ left: 90, top: 500, width: 200, height: 40 }, container, { left: 0, top: 0 });
    const b = contentRect({ left: 90, top: 200, width: 200, height: 40 }, container, { left: 0, top: 300 });
    expect(a).toEqual({ left: 50, top: 400, width: 200, height: 40 });
    expect(b).toEqual(a);
  });

  it("puts the cursor tip just inside the left edge, a little below the middle", () => {
    expect(tipPoint({ left: 100, top: 200, width: 400, height: 50 })).toEqual({ x: 124, y: 227.5 });
    // Wide boxes cap the inset at 28px so the cursor stays near the item's start.
    expect(tipPoint({ left: 0, top: 0, width: 1000, height: 10 })).toEqual({ x: 28, y: 5.5 });
  });

  it("scrolls a target to a third of the viewport, clamped to the scroll range", () => {
    expect(scrollTopFor({ left: 0, top: 1000, width: 10, height: 100 }, 600, 3000)).toBe(850);
    expect(scrollTopFor({ left: 0, top: 50, width: 10, height: 20 }, 600, 3000)).toBe(0);
    expect(scrollTopFor({ left: 0, top: 2950, width: 10, height: 20 }, 600, 3000)).toBe(2400);
  });

  it("knows when a target is already comfortably visible", () => {
    const r = { left: 0, top: 300, width: 10, height: 50 };
    expect(isInView(r, 0, 600)).toBe(true);
    expect(isInView(r, 290, 600)).toBe(false);
    expect(isInView(r, 0, 360)).toBe(false);
  });

  it("compares points with sub-pixel tolerance", () => {
    expect(samePoint({ x: 1, y: 1 }, { x: 1.2, y: 0.9 })).toBe(true);
    expect(samePoint({ x: 1, y: 1 }, { x: 2, y: 1 })).toBe(false);
    expect(samePoint(null, null)).toBe(true);
    expect(samePoint(null, { x: 0, y: 0 })).toBe(false);
  });
});
