# Pointer UI: look, cursor, font and motion

Pointer uses GitHub's Primer design language: white and gray surfaces, crisp gray
borders, green primary buttons, blue links and focus rings. Two colours are
Pointer's own: terracotta `--plan` for the plan pointer, and blue `--answer` for
the answer pointer. Everything here is plain CSS in `app/`. No npm dependency
was added.

| File | What it holds |
|---|---|
| `app/tokens.css` | Colour, shape and motion tokens. The lead froze the names, so you may change values but never rename one. |
| `app/globals.css` | The theme, the cursor, and the component classes (`btn`, `pill`, `box`, …). It also maps the old `--color-*` names onto the tokens. |
| `app/motion.css` | The animation library described below. |
| `public/cursors/*.svg` | The two cursor images. |

New code uses token names (`var(--fg)`, `var(--border)`, `var(--accent)`) and
never raw hex. The old names still resolve: `--color-ink` maps to `--fg`,
`--color-terracotta` maps to `--accent`, and so on. Don't use them in new code.

## Font

The font is **Geist** with **Geist Mono**, chosen as a neutral grotesk close to
GitHub's Mona Sans without copying it. `app/layout.tsx` loads it with
`next/font/google`. The font files are downloaded at build time and served by
the app itself, so the running demo never contacts Google and works offline.

The fonts are exposed as `--font-geist` and `--font-geist-mono`.
`globals.css` connects them to Tailwind's `font-sans` and `font-mono`. Headings
use the sans face. `font-serif` remains as an alias for Geist, so older markup
still renders.

## Cursor

The cursor is an outlined arrow (white fill, 1.5px dark outline, rounded joins,
soft shadow), modelled on the pointer in GitHub's homepage product demo.

| File | Used on | Hotspot |
|---|---|---|
| `public/cursors/arrow.svg` | everything (`html`) | `4 3` (the tip) |
| `public/cursors/arrow-click.svg` (blue outline, pale-blue fill) | `a[href]`, `button`, `[role=button]`, `[role=tab]`, `select`, `summary`, `label[for]`, checkbox/radio/file/range inputs, `.item-box`, and Tailwind's `cursor-pointer` | `4 3` |

- Two variables hold the cursor values: `--cursor-default` and `--cursor-click`.
  Use them in place of `pointer`: `cursor: var(--cursor-click)`.
- Text inputs, textareas and `contenteditable` elements keep the I-beam cursor.
  Disabled controls show `not-allowed`.
- Each `url()` names a system cursor as a fallback.
  `@media (forced-colors: active)` switches back to the system cursors.
  Keyboard focus rings are unchanged.
- The images are SVG, so they stay sharp on 2x screens.

## Motion library

Timing comes from tokens: `--dur-fast` (120ms), `--dur-base` (200ms),
`--dur-slow` (360ms) and `--dur-pointer` (700ms). The easings are `--ease-out`
(an expo-out settle), `--ease-in-out`, and `--ease-spring` (which overshoots a
little).

Every class is turned off or made static under
`prefers-reduced-motion: reduce`. `tests/ui/design.test.ts` checks this.

Entrance classes accept a stagger delay:
`style={{ "--anim-delay": `${i * 40}ms` } as React.CSSProperties}`.

| Class | Purpose and where it's used | Timing | Inspiration | Reduced motion |
|---|---|---|---|---|
| `.anim-fade-up` | Fades in while rising 6px. Used for cards, chat messages, log rows (`.log-row` uses it) and the report's progress box. | `--dur-base`, `--ease-out` | GitHub's quiet list entrances | Appears instantly |
| `.anim-pop` | Scales in from 0.92 with a spring. Used for badges, status pills and the pointer arriving. | `--dur-slow`, `--ease-spring` | Gemini's chip and sparkle arrivals | Appears instantly |
| `.anim-slide-in-right` | Slides in from 12px to the right. Used for side panels and drawers. | `--dur-slow`, `--ease-out` | GitHub's side panels | Appears instantly |
| `.anim-shimmer` | Skeleton block with a blue→violet→rose band sweeping across. Used as a "thinking" placeholder. | 1.8s, `--ease-in-out`, loops | Gemini's loading shimmer | A plain gray block |
| `.anim-shimmer-text` | The same sweep, clipped to text, for status lines such as "Pointer is reading…". | 2.2s linear, loops | Gemini's "Thinking" text | Static muted text |
| `.gemini-border` | A 1.5px conic-gradient ring that rotates, plus a soft glow. Put it on the input wrapper while the input is active. Set `data-active="false"` to fade it out. | 4s spin, `--dur-slow` fade | Gemini's input glow | The ring stays and stops spinning |
| `.anim-pulse-ring` | Two rings expand outward. Used for the plan pointer's "same spot" pulse. The colour comes from `currentColor`. | 1.6s, `--ease-out`, loops | Gemini's voice pulse | One still ring |
| `.anim-sparkle` | A 4-point star that twinkles (scale plus a 45° turn). Put it on an icon, or leave the element empty and it draws a gradient star itself. | 2.4s, `--ease-in-out`, loops | Gemini's sparkle mark | Still star |
| `.anim-typing` | Three dots that bounce one after another. Needs three child `span`s. | 1.2s, loops | Chat typing indicators | Three still dots at stepped opacity |
| `.anim-collapse` | Collapses a section's height and opacity with the `grid-template-rows: 0fr → 1fr` technique, so no JavaScript measuring is needed. Opens when `data-open="true"`. Closed content is `visibility: hidden`, so assistive tech skips it. | `--dur-slow` rows, `--dur-base` fade | GitHub's expandable sections | Opens and closes instantly |
| `.underline-tab` | A GitHub UnderlineNav tab whose 2px bar grows in when `data-active="true"`. To make the bar slide between tabs, wrap the tabs in `.underline-tabs` and add an `.underline-tabs-indicator` positioned with `--indicator-x` and `--indicator-w`. The bar is `--plan` unless you set `--underline-color`. | `--dur-base`, `--ease-out` | GitHub repo tabs | The bar jumps with no transition |

The Gemini colours live in `motion.css` as `--gemini-blue`, `--gemini-violet`,
`--gemini-rose` and `--gemini-gradient`. They are decorative only: never the
only signal of state, and never body text.

### Usage

```tsx
<li className="anim-fade-up" style={{ "--anim-delay": `${i * 40}ms` } as React.CSSProperties}>…</li>
<span className="pill pill-complete anim-pop">Complete</span>
<aside className="anim-slide-in-right">…</aside>

<div className="anim-shimmer h-3 w-2/3" aria-hidden />
<p className="anim-shimmer-text" role="status">Pointer is reading the checklist…</p>

<div className="gemini-border" data-active={busy}>
  <textarea className="w-full rounded-[12px] border border-[var(--border)] p-3" />
</div>

<span className="anim-pulse-ring text-[var(--plan)]" style={{ width: 20, height: 20 }} />
<span className="anim-sparkle text-lg" aria-hidden />
<span className="anim-typing text-[var(--fg-muted)]" role="status" aria-label="Thinking">
  <span /><span /><span />
</span>

<button aria-expanded={open} onClick={() => setOpen(!open)}>Details</button>
<div className="anim-collapse" data-open={open}>
  <div>…content…</div>
</div>

<nav className="underline-tabs">
  <button className="underline-tab" data-active={tab === "plan"}>Plan</button>
  <button className="underline-tab" data-active={tab === "ask"}>Ask <span className="counter">2</span></button>
</nav>
```

## Component classes added for the GitHub look

- `.box`, `.box-header`, `.box-title`, `.box-row`: GitHub's Box, a bordered,
  rounded container with a gray header and row dividers.
- `.counter`: the gray number bubble that sits beside a title.
- `.link`: blue link text, underlined on hover.
- `.app-header`, `.nav-link-inner`, `.legal-banner-icon`: site chrome.

The existing class names (`btn*`, `pill*`, `chip*`, `mock-tag`, `nav-link`,
`nav-active`, `legal-banner`, `picker*`, `item-*`, `log-*`, `suggestion*`,
`lawlens-note`, `thinking-dot`, `report-row`) are unchanged and restyled to
Primer. `.btn-primary` and `.btn-accept` are green. `.btn-stop` is GitHub's
danger button. `.mock-tag` is an outlined Label.

## Accessibility

`tests/ui/design.test.ts` checks that every text and surface token pair meets
WCAG AA (4.5:1). To pass, `--fg-subtle` was darkened from `#818b98` to
`#6e7781`. Focus rings are 2px `--accent`. The two pointers differ in shape and
label as well as colour.
