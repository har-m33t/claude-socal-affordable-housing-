// Guards the design lane's contracts: token contrast (WCAG AA), the motion class
// names other lanes code against, reduced-motion coverage, and that the homeowner's own cursor is the system one.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const tokens = Object.fromEntries([...read("app/tokens.css").matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

describe("design tokens", () => {
  // Text colour on the surfaces it is actually used on. AA body text = 4.5:1.
  const pairs: [string, string][] = [
    ["fg", "bg"],
    ["fg", "bg-subtle"],
    ["fg-muted", "bg"],
    ["fg-muted", "bg-subtle"],
    ["fg-muted", "bg-muted"],
    ["fg-subtle", "bg"],
    ["accent", "bg"],
    ["accent", "accent-subtle"],
    ["success", "success-subtle"],
    ["danger", "danger-subtle"],
    ["attention", "attention-subtle"],
    ["fg", "attention-subtle"],
    ["neutral", "bg"],
    ["plan", "bg"],
    ["plan", "plan-subtle"],
    ["answer", "answer-subtle"],
    ["fg-on-emphasis", "success-emphasis"],
    ["fg-on-emphasis", "danger"],
  ];
  it.each(pairs)("--%s on --%s meets WCAG AA (4.5:1)", (fg, bg) => {
    expect(tokens[fg], fg).toBeDefined();
    expect(tokens[bg], bg).toBeDefined();
    expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(4.5);
  });
});

describe("motion library", () => {
  const css = read("app/motion.css");
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  const classes = [
    "anim-fade-up",
    "anim-pop",
    "anim-slide-in-right",
    "anim-shimmer",
    "anim-shimmer-text",
    "gemini-border",
    "anim-pulse-ring",
    "anim-sparkle",
    "anim-typing",
    "anim-collapse",
    "underline-tab",
  ];
  it.each(classes)(".%s exists and is handled under prefers-reduced-motion", (c) => {
    expect(css).toMatch(new RegExp(`\\.${c}[\\s{:,\\[>.]`));
    expect(reduced).toMatch(new RegExp(`\\.${c}[\\s{:,\\[>.]`));
  });
  it("is imported by globals.css", () => {
    expect(read("app/globals.css")).toContain('@import "./motion.css"');
  });
});

describe("cursor", () => {
  // The homeowner's mouse cursor is never replaced; Pointer's two pointers are components.
  it("leaves the system cursor alone: no custom cursor images or url() cursors", () => {
    expect(existsSync(new URL("../../public/cursors", import.meta.url))).toBe(false);
    const css = ["app/globals.css", "app/motion.css", "components/stage/stage.css", "components/sidebar/sidebar.css"].map(read).join("\n");
    expect(css).not.toMatch(/cursor:\s*url\(/);
    expect(css).not.toMatch(/--cursor-(default|click)/);
  });
  it("draws the plan and answer pointers as components, not cursor images", () => {
    expect(readdirSync(new URL("../../components/stage", import.meta.url))).toContain("PointerCursor.tsx");
    const src = read("components/stage/PointerCursor.tsx");
    expect(src).toContain('"plan"');
    expect(src).toContain('"answer"');
  });
});
