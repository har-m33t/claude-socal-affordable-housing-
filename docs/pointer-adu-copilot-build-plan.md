# Pointer: ADU permit copilot build plan

Nov 7, 2026 · @harmeet

Pointer walks first-time homeowners through their city's ADU forms, steers them onto the
fastest approval path, and catches every mistake before the city does.

---

## Positioning

**Narrow goal:** a first-time homeowner submits a complete ADU application on the first try,
on the city's fastest path.

- **Primary user:** a low- or moderate-income homeowner in one OC city adding an ADU or
  legalizing an existing unit, doing the forms themselves, often in a second language. This is
  the lane's scenario C01. Made up; say so.
- **Next-month adopter:** that city's permit counter, which hands Pointer to applicants and
  uses Law Lens to catch its own outdated forms.
- **Focus city:** Anaheim. No second city until Anaheim works end to end.

Confirm these three facts in the first 20 minutes. The repo's data list backs some of the pitch
but not all of it:

| Claim | What the repo says | Action |
|---|---|---|
| ADU Express, a 1 to 3 day review track | Listed on Anaheim's ADU page as one of three tracks (VERIFIED-EXA) | Open the page and copy the eligibility rules and date |
| Anaheim has four free pre-approved plans | The repo lists Garden Grove's ADU Go with 4 free city plans. It does not list Anaheim pre-approved plans | Check Anaheim's page. If none, the shortcut card says what Anaheim does offer, or shows "unknown" |
| Checklist still cites old law | Anaheim's Nov 2025 checklist cites Gov Code 65852.2 and 65852.22 (VERIFIED-EXA) | Download it and screenshot the exact line |

Also confirm whether Anaheim has a legalization path for existing unpermitted units before you
promise it. The repo shows AB 2533 legalization pages for Costa Mesa and Fullerton, not Anaheim.
A partner like Habitat is an idea, not a commitment, unless someone has asked them.

---

## The three moments, run live

The app is an editor: the city's real checklist on the left, the homeowner's draft packet beside
it, and an agent whose every action plays out on screen. It acts only on the draft inside the app
and the homeowner accepts or rejects each change.

1. **Find the fast path.** A few questions, then: "You may qualify for ADU Express." Plus the
   shortcut card. City page and date checked on screen.
2. **Follow it correctly.** The pointer hand walks the checklist one item at a time, explains it
   in plain language (Spanish read-aloud if time allows), and checks the made-up uploaded
   documents.
3. **Catch problems before the city does.** Missing items turn red. Law Lens makes the old
   65852.2 citation glow with the current section and its source.

**Output:** a readiness report of what's complete, what's missing and what to ask the city.
No submit button.

**What "live" looks like:** an action log streams beside the editor ("Reading item 6… site plan
not found… drafting a note"). Each action is one of five small tools: `point_to`, `highlight`,
`mark_item` (complete, missing or unknown), `draft_field`, `add_note`. Drafted text appears as a
suggestion with accept and reject. A stop button halts the agent.

---

## Documents Pointer handles

Pointer explains and tracks every document; it drafts answers only from facts the homeowner
gives, and never signs, notarizes or records anything.

| Document or requirement | What Pointer does |
|---|---|
| ADU application and verification paperwork | Explains fields; drafts answers from facts the applicant supplies |
| Building plans, calculations, construction documents | Explains what is asked; tracks what must come from a designer or engineer |
| Site-plan checklist | Walks the checks; flags unanswered items |
| Liability affidavit and owner signatures | Explains the acknowledgments; flags missing signatures |
| Property covenant | Explains the process; tracks getting it, notarizing and recording |
| Deposit-account paperwork | Explains its purpose and that a deposit is not a final charge |
| School-fee, transportation-agency and address forms | Says what supporting paperwork is needed and where it goes |
| E-signature disclosure, where it applies | Explains the extra requirement for signing digitally |

Check this list against Anaheim's checklist. It closely matches Irvine's submittal list in the
repo (verification form, covenant, hold harmless, school fee form, transportation corridor form,
and a deposit). The repo lists Anaheim's checklist items as sewer capacity verification, meter
location, new address and the JADU covenant. **Build the table from Anaheim's actual PDF.**

---

## How it saves money

Pointer saves money mainly by avoiding correction rounds and steering people onto faster, cheaper
paths; show it as a formula with sliders, not a promised figure.

$$\text{savings} = R \times \left( W \times C + H \times r \right) + D$$

| Input | Meaning | Status |
|---|---|---|
| `R` | Correction rounds avoided | **ASSUMPTION.** The repo found no public data on correction rounds |
| `W` | Weeks each round adds | **ASSUMPTION** |
| `C` | Weekly carrying cost while waiting (loan interest, rent elsewhere) | **ASSUMPTION**, entered by the homeowner |
| `H`, `r` | Review hours per round and the city's hourly rate | Irvine bills ADU planning review at $210.70 an hour with a $1,500 deposit (repo, VERIFIED). Anaheim's rate not checked |
| `D` | Design cost avoided by using a pre-approved plan, if the city offers one | **ASSUMPTION** |

The city side saves too: every incomplete application a permit tech doesn't send back is counter
time saved. The brief's own mock example is the anchor: waiting costs $85k of a $535k home, and a
10-month slip made the fundraising gap about 7 times bigger.

---

## Judging fit

| Area | Pointer's answer |
|---|---|
| **Impact** | Anaheim's permit counter (or a home-repair nonprofit) could hand it to applicants next month |
| **Works** | Real Anaheim checklist and city pages, sources and dates on screen, made-up applicant |
| **Scale** | Each new city is a checklist plus a fast-path entry. The repo's 34-city sheet is the roadmap, and the same engine handles SB 9 forms for small builders |
| **Innovation** | An AI that points instead of talks, and catches the city's own mistakes |

**Not in scope:** market listings, portal auto-fill, a submit button, a second city before
Anaheim works.

---

## Holes in the plan and the fixes

The biggest risks were two stacks to integrate in three hours, a pointer that depends on Claude
quoting text exactly, and law and fast-path claims nobody has read yet; the fixes below are
already applied to the sections that follow.

| Hole | Why it hurts | Fix |
|---|---|---|
| Next.js plus FastAPI plus Python redaction | Two stacks, two installs, CORS and streaming glue to debug on venue wifi | One Next.js app in TypeScript. Claude runs in its API routes; redaction runs in the browser |
| Presidio needs spaCy models | Large downloads and a Python service for fake data | Regex and dictionary redaction in the browser. Data never leaves the laptop unredacted, which is a stronger story |
| Hand points by matching Claude's quoted text | Claude paraphrases; the hand misses on stage | Pre-compute each checklist item's page and box once into `anaheim.json`. Claude names item IDs, never coordinates or quotes |
| Anaheim's PDF may be a scan with no text layer | No text spans to point at | Check in the first 10 minutes. If it's a scan, measure boxes by hand for the items you demo |
| "Checks the uploaded documents" is undefined | Claude guesses what a file is | Fake packet has a manifest. Claude classifies each file to a document type or says unknown; matching to checklist items is plain code |
| ADU Express eligibility not yet read | Fast-path answer could be invented | Questions come only from the city page text, stored with its date. Result always says "may qualify, confirm with the city" |
| 65852.2 maps to a range, not one section | Law Lens could show a wrong single section | Show the range 66310 to 66342 unless a specific section is confirmed on leginfo in a browser. JADU (66333 per the repo) only once confirmed |
| Savings sliders prefilled with guesses | Reads as made-up numbers presented as facts | Only the sourced input is prefilled; the rest start empty and say ASSUMPTION |
| Spanish explanations are machine translated | Could mislead on legal terms | Label as machine translation and link HCD's Spanish handbook |
| Parallel builders drift apart | Pieces don't fit at 1:00 | Freeze shared JSON contracts at 11:55 before anyone builds (see the team section) |
| Schedule started at 11:30 | It's already past that | Re-timed from 11:45 |
| Uploaded files can carry instructions | Prompt injection could steer the agent | Covered in the security layer below |

---

## Scope: what we build vs. what we demo

The engine is built for any OC city and more than one project type; the live demo shows only
Anaheim ADUs, end to end, on verified sources.

| | Built into the product | Shown in the live demo |
|---|---|---|
| **Cities** | Any city, loaded from `cities/<city>.json` (checklist items, fast-path rules, URLs, date checked). All 34 OC cities listed from the repo's `oc-cities.json` | Anaheim only. Irvine as a city switch only if Anaheim works by 1:15 |
| **Project types** | ADU and SB 9 as project-type packs: `types/adu.json`, `types/sb9.json`, each with its own statute rules and clocks | ADU only. SB 9 pack shown as a stub with "rules not yet verified" |
| **Law Lens** | Generic old-to-new statute map in `statutes.json` | The Anaheim 65852.2 catch |
| **Coverage view** | Table of all 34 cities: live, checklist found, or not yet checked, each with a date | Shown for 5 seconds as the Scale moment |

**Rule for anything outside the demo:** it may exist in the code and on the coverage table, but
every unchecked city or pack shows "not yet verified" and never produces advice. No city goes live
until a person has read its checklist and filled in its date.

**Pitch line:** "A new city is a new file, and a new project type is a new pack. Anaheim is live
today; here's the other 33."

---

## Build

A Next.js editor with a PDF viewer, a small FastAPI backend that streams Claude's tool calls, and
a local redaction step; get the hand pointing at one real checklist line by 12:30.

- **One app:** Next.js, TypeScript and Tailwind. `react-pdf` renders the checklist; the hand is an
  animated SVG that moves to the pre-computed box for an item ID. Action log, accept/reject
  suggestions, city and project-type pickers reading config; unverified entries greyed out.
- **Agent:** a Next.js API route runs the Claude tool loop with the TypeScript SDK and streams
  each tool call to the browser as server-sent events. It loads the chosen `cities/<city>.json`
  and `types/<type>.json`; nothing Anaheim-specific is hard-coded. The HCD ADU Handbook goes in as
  a PDF document with citations on and caching.
- **Redaction:** in the browser, before any request. Regex and dictionary rules replace names,
  addresses, phone numbers, emails and APNs with tokens; the token map never leaves the page.
  Before-and-after view.
- **Config files:** `statutes.json` (each entry with source URL and date), `cities/anaheim.json`
  (complete, with item boxes), `cities/_template.json`, 33 stub city files with
  `verified: false`, `types/adu.json` (complete), `types/sb9.json` (stub).
- **Demo safety:** a recorded replay of one agent run, played from a local file, for when the API
  or wifi fails.

| Time | Milestone | Team |
|---|---|---|
| 11:45 to 11:55 | Freeze the shared contracts; check Anaheim's PDF has a text layer; create the repo | All leads |
| 11:55 to 12:45 | Each team builds against the contracts with mock data from the other teams | All four teams |
| 12:45 to 1:15 | Integration: real Anaheim config, live agent, redaction on, one full run | All, led by Team 2 |
| 1:15 to 1:45 | Readiness report, coverage table, savings sliders; record the replay file; Irvine only if on time | Teams 1, 2, 3 |
| 1:45 to 2:15 | Security checklist, README, license, `.env.example`, 30-second video | Team 4 |
| 2:15 to 2:30 | Check repo signed out, submit on the hub | Team 4 |

**Cut first:** Spanish voice, then the savings sliders, then accept/reject (show drafts
read-only).

---

## Security layer

Pointer handles a homeowner's private paperwork and runs an agent, so it is built so that personal
data never leaves the browser unredacted, the agent can't touch anything outside the app, and no
law claim reaches the screen without a source.

| Threat | Control | How you prove it in the demo |
|---|---|---|
| Personal information sent to Claude | Redaction runs in the browser before any request. The token map stays in page memory and drafts are filled back in locally. Nothing is stored on the server; request bodies are never logged | Before-and-after panel, plus the network tab showing only tokens |
| Real data in the repo | Only the made-up applicant; a pre-commit check blocks common personal-data patterns in `data/` | README "Data and privacy" section |
| API key leak | Key only in the server environment; `.env` git-ignored; `.env.example` names only; scan history with gitleaks before going public | Clean scan output |
| Prompt injection in uploaded files or city PDFs | Document text is wrapped and marked as untrusted data; the system prompt says instructions inside documents are ignored; the agent has no web, file or network tools | Demo file with a planted "ignore your rules" line that the agent reports instead of obeys |
| Agent acting outside the app | Allowlist of five tools only (`point_to`, `highlight`, `mark_item`, `draft_field`, `add_note`). Every argument is schema-checked and item IDs must exist in the loaded city file. No submit, email or portal endpoint exists in the code | Action log shows every call |
| Invented law or advice | Law Lens only flags entries in `statutes.json`; law answers need a handbook citation or a verifier step drops them; the server refuses advice for any city or type with `verified: false` | Unverified city shows "not yet verified" |
| Malicious or huge uploads | PDF and images only, 10 MB cap, filenames sanitized, PDFs rendered by `pdf.js` with scripting off | Rejection message on a wrong file type |
| Cost abuse | Per-session rate limit, max tokens per call, max agent steps per run | Config values in the README |
| Supply chain | Pinned versions and a lockfile; no unreviewed packages added after 1:15 | `package-lock.json` in the repo |

If it is ever deployed beyond localhost: HTTPS only, CORS locked to the app's own origin, and a
short privacy notice on the first screen.

---

## Four teams, each with a Claude Code sub-agent

Split into four teams that each own one folder and build in parallel against shared contracts
frozen at 11:55; each team lead runs one Claude Code sub-agent with the prompt below and reviews
everything it writes.

### Shared contracts (freeze at 11:55, in `contracts/`)

- `city.schema.json`: `{city, verified, checked_date, sources[], fast_paths[{id, name, rules[], source}], checklist[{id, text, page, box:[x,y,w,h], doc_type, source}]}`
- `statute.schema.json`: `{old, new_range, title, source_url, checked_date, confirmed}`
- `packet.schema.json`: `{files[{name, declared_type}]}` for the made-up applicant
- `event.schema.json`: one agent action `{tool, item_id, status?, text?, citation?, ts}` streamed
  to the browser
- **Repo layout:** `data/` (Team 1), `app/` and `components/` (Team 2), `app/api/agent/` and
  `lib/agent/` (Team 3), `lib/redact/`, `tests/security/`, `README.md` (Team 4)

| Team | Owns | Done when | Hands to |
|---|---|---|---|
| **1. Data and rules** | Fact checks, `cities/anaheim.json` with item boxes, `statutes.json`, `types/adu.json`, 33 stubs, fake packet, Sources table | Anaheim config validates against the schema and every entry has a URL and date | Teams 2 and 3 at 12:45 |
| **2. Editor and pointer** | PDF viewer, hand animation, action log, suggestions, pickers, readiness report, coverage table, theme | Hand moves through mock events from `event.schema.json` | Integration at 12:45 |
| **3. Agent** | API route, tool loop, streaming, prompts, citations, verifier, replay recorder | Mock city file in, valid event stream out | Team 2 at 12:45 |
| **4. Security and ship** | In-browser redaction, injection test file, security tests, gitleaks, README, video, submission | Every row in the security table has a passing check | Submission at 2:15 |

### Sub-agent prompts

Each lead pastes their prompt into Claude Code in the repo (`CLAUDE.md` is already there with the
event rules).

**Team 1, data and rules**

```text
You are the data agent for Pointer, an ADU permit copilot for Anaheim. Work only in
data/. Using only files I download into data/raw/ (Anaheim's ADU page, its November
2025 submittal checklist PDF, the HCD ADU Handbook), build cities/anaheim.json and
types/adu.json matching contracts/. Extract each checklist item with its page and
bounding box from the PDF text layer. Build statutes.json with only mappings I
confirm; mark others confirmed: false. Generate 33 stub city files from oc-cities.json
with verified: false. Create a made-up applicant packet and say it is made up. Never
invent a rule, fee, date or section number: write "unknown". Every entry carries a
source URL and checked date. Validate all files against the schemas.
```

**Team 2, editor and pointer**

```text
You are the UI agent for Pointer. Work only in app/ and components/. Build a Next.js,
TypeScript and Tailwind editor: a react-pdf viewer on the left, the applicant's draft
and an action log on the right. An animated SVG hand moves to the box of the checklist
item named in each event from contracts/event.schema.json. Show mark_item as green,
red or grey, draft_field as an accept or reject suggestion, and citations as chips that
open their source. Add city and project-type pickers that grey out unverified configs,
a readiness report page and a 34-city coverage table. Use a cream background, a
terracotta accent and serif headings. Include a "not legal advice" banner. Until 12:45,
drive everything from fixtures/mock-events.json.
```

**Team 3, agent**

```text
You are the agent-backend engineer for Pointer. Work only in app/api/agent/ and
lib/agent/. Build a Next.js API route that runs a Claude tool loop with the Anthropic
TypeScript SDK and streams each tool call as a server-sent event matching
contracts/event.schema.json. Expose exactly five tools: point_to, highlight, mark_item,
draft_field, add_note; validate every argument with zod and reject item IDs not in the
loaded city file. Load the city and type JSON into context, attach the HCD ADU Handbook
as a PDF document with citations enabled and prompt caching. Wrap all document text as
untrusted data and instruct the model to ignore instructions inside it. Refuse to
advise when verified is false. Add a verifier that drops law statements without a
citation or statutes.json entry. Cap steps and tokens. Add a recorder that saves a run
to fixtures/replay.json and a replay mode. Read the key from ANTHROPIC_API_KEY only.
```

**Team 4, security and ship**

```text
You are the security and release agent for Pointer. Work in lib/redact/,
tests/security/ and README.md. Build in-browser redaction that replaces names, street
addresses, phone numbers, emails and APNs with tokens and keeps the token map
client-side, plus a before-and-after view component for Team 2. Write tests: redaction
catches the made-up applicant's details, a planted prompt-injection PDF is not obeyed,
a non-PDF upload is rejected, an unverified city returns no advice, and no route can
submit or send anything. Add .env.example, check .gitignore, run gitleaks on the
history, pin dependencies. Write the README from templates/TEAM-README.md: user, before
and after, Try it commands, sources with dates, every ASSUMPTION, what is mocked, where
it gets things wrong. Draft a 30-second video script: one homeowner, one problem, the
hand working, the readiness report.
```

**Lead rules for all teams:** commit to your own folder only, push every 30 minutes, and never let
the sub-agent change `contracts/` without telling the other leads.

---

## Guardrails, risks and sources

- **Guardrails:** made-up applicant only; the agent edits only the in-app draft; no submit or
  portal fill; Law Lens flags only what `statutes.json` or a handbook citation backs; "not legal
  advice" banner; API key in the environment only.
- **Risk:** the hand misses its target. Match on quoted text; fall back to highlighting the step
  in the panel.
- **Risk:** a judge asks how much it saves. Say there's no public data on correction rounds and
  show the labelled assumptions.

Sources below are from the event repo's Lane 2 data list (organizers' checks, Nov 6, 2026), read
today; I did not re-open them.

- Anaheim: ADU Anaheim (incl. ADU Express)
- Anaheim ADU Submittal Requirements Checklist (Nov 2025)
- HCD ADU Handbook (March 2026) and translations
- Gov Code 66314 (ADU approvals)
- Irvine: Constructing an ADU and fee schedule
- Garden Grove: ADU Go

---

## Transcription note

Added when this plan was committed to the repo, not part of the plan as written.

**The "Anaheim has four free pre-approved plans" fact-check is already answered in the repo, and
the plan's reading of it is wrong.** The Positioning table says the repo "does not list Anaheim
pre-approved plans." It does — `lanes/2-clear-it/data/DATA-SOURCES.md` line 141:

> Anaheim: Pre-Approved Plan Catalogue — 4 free plans, 224 to 1,199 sf — HTML —
> <https://www.anaheim.net/6351/Pre-Approved-Plan-Catalogue> — VERIFIED-EXA

So the claim is supported, at VERIFIED-EXA, and `D` (design cost avoided by a pre-approved plan)
applies to Anaheim rather than being hypothetical. Team 1 should still open the page and record
its own checked date, but this is a confirmation, not an open question.

Source URLs for the six sources listed above, from the same lane data list, are recorded in
[`research/sources.md`](../research/sources.md).
