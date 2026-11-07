// Guards the design lane's contracts: token contrast (WCAG AA), the motion class
// names other lanes code against, reduced-motion coverage, and the cursor assets.
import { existsSync, readFileSync } from "node:fs";
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
  it.each(["arrow", "arrow-click"])("public/cursors/%s.svg exists and is wired with the tip hotspot", (n) => {
    expect(existsSync(new URL(`../../public/cursors/${n}.svg`, import.meta.url))).toBe(true);
    expect(read("app/globals.css")).toContain(`url("/cursors/${n}.svg") 4 3`);
    expect(read(`public/cursors/${n}.svg`)).toContain('d="M4 3 ');
  });
});
