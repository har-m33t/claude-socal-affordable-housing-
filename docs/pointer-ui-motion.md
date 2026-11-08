# Pointer UI: look, pointers, font and motion

Pointer uses GitHub's Primer design language: white and gray surfaces, crisp gray
borders, green primary buttons, blue links and focus rings. Two colours are
Pointer's own: terracotta `--plan` for the plan pointer, and blue `--answer` for
the answer pointer. Everything here is plain CSS in `app/`. No npm dependency
was added.

| File | What it holds |
|---|---|
| `app/tokens.css` | Colour, shape and motion tokens. The lead froze the names, so you may change values but never rename one. |
| `app/globals.css` | The theme, `cursor: pointer` on clickable things, and the component classes (`btn`, `pill`, `box`, …). It also maps the old `--color-*` names onto the tokens. |
| `app/motion.css` | The animation library described below. |
| `components/stage/PointerCursor.tsx` | The two on-screen pointers (plan and answer). |

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

## The homeowner's cursor

The homeowner's own mouse cursor is the **system cursor** and is never replaced:
no custom cursor images, no `cursor: url(...)`. Tailwind's preflight gives
buttons `cursor: default`, so `globals.css` puts the normal `cursor: pointer` on
links, buttons, `[role=button]`, `[role=tab]`, selects, `summary`, `label[for]`
and checkbox/radio/file inputs, and `not-allowed` on disabled controls. Text
fields keep the browser's I-beam. `tests/ui/design.test.ts` checks that no
custom cursor comes back.

## The two pointers

Pointer's two on-screen pointers are drawn as multiplayer collaborator cursors,
like the ones in GitHub's homepage product demo: a crisp arrow with rounded
joins, a 1.5px white outer outline so it reads on any page, a soft drop shadow,
and a rounded name tag attached at the arrow's lower right. They are components
(`components/stage/PointerCursor.tsx`), positioned by
`components/stage/PointerLayer.tsx`. They are decorative (`aria-hidden`, never
take clicks). Screen readers get the existing `aria-live` announcement instead
("Answer is on …").

| | Plan pointer | Answer pointer |
|---|---|---|
| Meaning | The homeowner's current step | Where the answer to their question is |
| Arrow | **Solid**, filled `--plan` (terracotta), white outline | **Outlined**: white fill, 2px `--answer` (blue) stroke, white halo |
| Extra mark | none | A blue **"?" badge** at the arrow's tail |
| Name tag | Filled `--plan`, white text, white rim: "Step 4 of 13" | Outlined `--answer` on white: "Your question" |
| Extras | Pulses when the answer is the current step | A "Back to my step" button under the tag |

**Colour is never the only signal.** The two differ in fill (solid against
outlined), in the "?" badge, and in the tag's words, so they can be told apart
in greyscale or by anyone who can't tell terracotta from blue.

**Hotspot.** The arrow's tip is the hotspot. The tip sits at (3, 2) in the
24×30 viewBox, drawn at 1.2× (3.6px, 2.4px on screen). The pointer's anchor is
placed exactly on the target point, and the SVG is offset so the tip lands on
it. The target point is `tipPoint()` in `components/stage/geometry.ts`: inset
from the target's left edge by min(6% of width, 28px), and 55% of the way down.
The arrow and its tag hang down and to the right of that point, so they cover
as little of the target's text as possible. Near the page's right edge, the tag
and button flip to the left of the tip. Verified live at 1440, 1100 and 900px:
the tip lands within 0.02px of the target point.

**Motion** (keyframes in `components/stage/stage.css`):

| Animation | What it does | Timing | Reduced motion |
|---|---|---|---|
| glide | The anchor's `transform` transitions, so a pointer glides from target to target on its document | `--dur-pointer` (700ms), `--ease-out` | Jumps |
| appear (`.anim-pop`) | A pointer that was hidden (first show, tab switch, new answer) appears in place, scaling in from the tip, without gliding across the page | `--dur-slow`, `--ease-spring` | Appears instantly |
| tap (`stage-cursor-tap`) | A subtle click on arrival: scale 1 → 0.92 → 1 around the tip, after the glide lands. Replays on every new target | 360ms, `--ease-out`, delayed `--dur-pointer` | None |
| ripple (`stage-cursor-ripple`) | With the tap, a ring in the pointer's colour grows from the tip (0 → 26px) and fades | 520ms, `--ease-out`, delayed `--dur-pointer` | Hidden |
| pulse (`.anim-pulse-ring`) | When the answer is the current step, rings pulse from the plan pointer's tip instead of a second pointer appearing | 1.6s, loops | One still ring |
| fade | A dismissed pointer fades out where it is | `--dur-slow` | `--dur-fast` |
| scroll | The focused target (answer, else step) is scrolled into view if it isn't comfortably visible | smooth `scrollTo` | Instant |

**Re-measuring.** The layer re-measures (at most once per frame) when the
document resizes, targets mount, the window resizes, or an animation or
transition inside the document ends. That last trigger matters: the pane's
fade-up moves targets with a transform, which no ResizeObserver sees.

**SVG ids.** Each pointer instance gets its own shadow filter id from `useId`.
Every document pane mounts a pointer layer, and a duplicated id resolves to the
first copy, which may sit in a hidden pane and blank the pointer.

## Document stage animations

From the header comments in `components/stage/*`. Every one is switched off or
made instant under `prefers-reduced-motion`.

| Where | Animation | What it does | Timing | Reduced motion |
|---|---|---|---|---|
| `DocumentStage` | `.anim-fade-up` | A document pane fades up the first time it opens | `--dur-base` | Instant |
| `DocTabs` | `.underline-tab` | The active tab's underline grows in | `--dur-base`, `--ease-out` | Jumps |
| `DocTabs` | `.anim-pop` | The "Step N" marker pops in on the step's tab | `--dur-slow`, spring | Instant |
| `DocTabs` | edge fade | When tabs overflow, the strip scrolls sideways (hidden scrollbar). A 40px mask fades whichever edge has tabs behind it | `--dur-fast` | Instant |
| `DocTabs` | reveal scroll | The active tab scrolls into view on change and on resize. Long titles truncate, with the full title as a tooltip | smooth `scrollTo` | Instant |
| `PdfDocument` | box state | Overlay boxes transition background, border and shadow as the run marks them | `--dur-slow` | Instant |
| `PdfDocument` | `.stage-box-answer` | A blue ring fades in on the box the answer pointer is on | `--dur-slow` | Instant |
| `FileBoard` | `.anim-fade-up` + `--stagger` | Cards enter, staggered 40ms apart | `--dur-base` | No stagger |
| `FileBoard` | `.anim-pop` | A file the homeowner just added | `--dur-slow` | Instant |
| `FileBoard` | `.anim-slide-in-right` | The add-a-file drawer slides in | `--dur-slow` | Instant |
| `FileBoard` | card state | Border, background and shadow transition as the run marks a card. The pointed card lifts 1px | `--dur-slow` | No lift, instant |
| `BackToStep` | `.anim-fade-up` | The banner and the floating button enter | `--dur-base` | Instant |
| `PointerLayer` / `PointerCursor` | glide, appear, tap, ripple, pulse, fade, scroll | See "The two pointers" above | | |

## Sidebar animations

From the header of `components/sidebar/sidebar.css`.

| Animation | What it does | Timing | Reduced motion |
|---|---|---|---|
| `sb-progress-fill` | The step progress bar's width and the ring stroke ease to the new value | `--dur-slow` (360ms), `--ease-out` | Jumps |
| `sb-live` | The "Running" dot breathes while the run plays | 1.6s, `--ease-in-out`, loops | Static dot |
| `sb-speak` | Three bars bounce while a reply is spoken aloud | 0.9s, `--ease-in-out`, loops, 0.15s stagger | Static bars |
| `sb-tip` | A tooltip fades in after a short hover delay | `--dur-fast` (120ms), 300ms delay, `--ease-out` | No fade, still shown |
| `sb-row-current` | The current target row slides its terracotta marker in | `--dur-base` (200ms), `--ease-out` | No transition |

The sidebar also uses these shared utilities: `.anim-fade-up` (step card,
messages), `.anim-pop` (status dots, "Run finished"), `.anim-slide-in-right`
(rail expand), `.anim-shimmer` + `.anim-shimmer-text` (thinking placeholder),
`.gemini-border` (input while thinking), `.anim-sparkle` (Ask icon when an
answer is unseen), `.anim-collapse` (done steps), and `.underline-tabs` with its
indicator (tab slide).

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
| `.anim-pop` | Scales in from 0.92 with a spring. Used for badges, status pills and a pointer appearing. | `--dur-slow`, `--ease-spring` | Gemini's chip and sparkle arrivals | Appears instantly |
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

## Voice and language (Ask tab)

| Animation | Purpose | Duration / easing | Reduced motion |
|---|---|---|---|
| `.anim-pulse-ring` on the mic (in `--danger`), red composer border | Shows the mic is listening | utility's | static ring |
| `.anim-pop` on the language menu (origin top right) | Menu opens from its button | utility's | no pop |
| `.anim-fade-up` on mic panels and on the translation / original toggle | New state enters without a jump | utility's | instant |
| `.sb-meter > span` width transition | On-device model download progress | `--dur-slow`, `--ease-out` | jumps |
| `.sb-mic`, `.sb-lang-btn` background transitions | Hover and active feedback | `--dur-fast` | instant |

Voice input and translation run on-device where the browser supports it (Chrome's on-device speech
recognition and Translator). Read-aloud uses only on-device voices; with no voice for the chosen
language, the reply says so instead of speaking in the wrong voice.
