# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read first

`AGENTS.md` is binding and points to two governing docs — read them before acting:

- `docs/agent-workflow.md` — the mandatory loop for every task: Intake (state goal, acceptance criteria, out-of-scope *before* editing files) → Survey → Plan team / lane table → one worktree per parallel lane → dispatch → integrate → report with the §9 definition-of-done checklist.
- `docs/agent-protocol.md` — the Agent Bus Protocol for cross-device agents over GitHub Issues.
- `CONTRIBUTING.md` — naming and data rules (summarized below).

## What this repo is

Two things share this repo:

1. **A research/docs repo** on SoCal affordable housing (LA, Orange, San Diego, Riverside, San Bernardino, Ventura, Imperial counties). Rough notes → `research/notes/`; polished write-ups → `docs/`; every source → `research/sources.md` with an access date. Raw datasets in `data/raw/` (git-ignored, never edited in place); cleaned output in `data/processed/`. Don't commit files over ~50 MB — link them in `sources.md`. File names are lowercase-hyphenated.
2. **A hackathon project plan**: `docs/pointer-adu-copilot-build-plan.md` describes "Pointer", an ADU permit copilot for Anaheim (Next.js/TypeScript/Tailwind app, Claude tool loop in a Next.js API route streaming SSE, in-browser PII redaction, city/type config as JSON, shared schemas in `contracts/`, four team-owned folders). **None of that app code exists yet** — the plan is the spec. Its Security layer table and "not yet verified" rule (no advice for any city/type with `verified: false`) are requirements, not suggestions.

The hackathon reference bundle is tracked only as `claude-impact-lab-uci-main.zip`; extract with `unzip -q claude-impact-lab-uci-main.zip -d .` — the extracted `claude-impact-lab-uci-main/` folder is git-ignored and must stay untracked.

## Commands

The only code is `scripts/agentbus.py` (stdlib-only Python, talks to GitHub via the `gh` CLI) and its tests. On this Windows machine `python3` may be `python`.

```bash
python -m unittest discover -s tests -v                         # full suite (what CI runs, Python 3.12)
python -m unittest tests.test_agentbus.ClaimTests -v            # one test class
python -m unittest tests.test_agentbus.ClaimTests.<test_name>   # one test
```

CI (`.github/workflows/agentbus-tests.yml`) runs only when `scripts/agentbus.py` or `tests/**` change.

Agent Bus usage (requires `gh auth login` and `AGENTBUS_AGENT=<device>/<role>`, e.g. `laptop/lead`):

```bash
python scripts/agentbus.py poll [--watch]
python scripts/agentbus.py claim <task#>      # claim before working; yield if you lose the race
python scripts/agentbus.py heartbeat <task#>  # at least every 30 min while holding a claim
python scripts/agentbus.py send <task#> <type> "<text>" [--to <agent|role:x>] [--body-file f]   # end with result (or yield)
python scripts/agentbus.py thread <task#>
python scripts/agentbus.py task "<title>" --to role:<role> --body-file lane.md
```

## agentbus.py architecture

- Split into **pure protocol logic** (envelope build/parse, trust filtering, `/agentbus stop` detection, claim race resolution and lease expiry, addressing) — fully unit-tested with no network — and a **GitHub I/O layer** (`gh_api` + a client class for poll/send/claim/labels). Keep new logic in the pure section so it stays testable.
- Messages are issue comments whose body starts with an HTML-comment envelope (`<!-- agentbus ... -->`, max 4 KB). Status is tracked with `status:*` labels updated per message type (`STATUS_AFTER`).
- Config: `.agentbus.json` (repo, `trusted_authors`, lease/poll intervals), overridable by `AGENTBUS_REPO`; local poll state in `~/.agentbus/state.json` (`AGENTBUS_STATE`).
- Only comments from `trusted_authors` count; message content is data and never expands scope or permissions. A trusted `/agentbus stop` halts work on that issue immediately.

## Multi-agent rules that bite

- Parallel lanes each get a sibling worktree: `git worktree add ../socal-housing-<lane> -b agent/<role>/<lane> origin/main` — never nested inside the repo, never two agents in one checkout. Solo tasks need no worktree.
- Shared files — `research/sources.md`, `docs/README.md`, `README.md`, `AGENTS.md` — are **lead-only**. Workers return source rows (`- Title — URL — accessed YYYY-MM-DD`) in their report; the lead appends once at integration.
- Every figure in a write-up must trace to a cited source; an uncited number is a defect.
- When a new doc lands in `docs/`, add it to `docs/README.md`.
