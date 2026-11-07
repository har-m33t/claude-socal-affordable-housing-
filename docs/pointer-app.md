# Pointer - agent backend

ADU permit copilot for Anaheim. This directory is the Next.js app from
[`docs/pointer-adu-copilot-build-plan.md`](../docs/pointer-adu-copilot-build-plan.md).
It lives under `pointer/` rather than the repo root so it does not collide with
the research repo's own `data/` and `tests/`.

**Prototype. Not legal advice.** No submit button exists, and none may be added.

## What is built here

Team 3's lane: the agent backend. A Next.js API route that runs a Claude tool
loop and streams each tool call to the browser as a server-sent event.

| Path | Owner | What |
|---|---|---|
| `contracts/*.schema.json` | lead (frozen) | The wire contracts. Changing one breaks every lane. |
| `lib/agent/types.ts` | lead (frozen) | The code contract: interfaces and signatures the lanes compile against. |
| `lib/agent/tools.ts`, `validate.ts` | lane `agent-tools` | The five tools, zod schemas, item-id validation. |
| `app/api/agent/route.ts`, `lib/agent/{loop,sse,prompt,config}.ts` | lane `agent-loop` | Route, Claude tool loop, SSE, system prompt, caps. |
| `lib/agent/{verifier,recorder,replay}.ts` | lane `agent-verifier` | Law-claim verifier, run recorder, replay mode. |
| `data/` | Team 1 | City configs, project-type packs, statute map. |
| `fixtures/` | lead | Synthetic test data. Never shown to a user. |

## Run

```bash
npm install          # pinned; lockfile committed
npm run typecheck    # tsc --noEmit
npm test             # vitest, no network
npm run dev          # needs ANTHROPIC_API_KEY for a live run
```

## Data and privacy

- The only applicant is made up (`fixtures/packet.json`, `synthetic: true`).
- The key is read from `ANTHROPIC_API_KEY` and nowhere else. `.env` is ignored;
  `.env.example` carries names only.
- Source PDFs go in `data/raw/`, which is git-ignored.

## Verified vs. not

`data/cities/anaheim.json` is **`verified: false` on purpose**. Its checklist
items come from the event bundle's Lane 2 data list (the organizers' 2026-11-06
check), not from reading the November 2025 PDF, and no item has a page or box
yet. The agent refuses to advise on any city or project type whose `verified`
flag is false. Team 1 flips it only after a person opens the PDF, extracts each
item's page and box, and sets `checked_date`.

Everything in `fixtures/` is synthetic, including `mock-city.json`, which is
`verified: true` so the happy path is testable. It is not a real jurisdiction.

## ASSUMPTIONS

- `fixtures/mock-city.json` boxes, items and fast-path rules: invented for tests.
- Anaheim ADU Express eligibility rules: **unknown**, deliberately empty. Nobody
  has read the city page text.
- `statutes.json`: the 65852.2 -> 66310-66342 mapping is `confirmed: true` from
  the Lane 2 list. The JADU 65852.22 -> 66333 mapping is `confirmed: false`
  until someone opens leginfo in a browser, per the build plan.
