# Pointer

> For a first-time homeowner adding an ADU in Anaheim: Pointer walks the city's real checklist,
> steers them onto the fastest approval path, and catches mistakes before the city does.

**Team:** [team name]
**Members:** [names]
**Lane:** 2 Clear it
**Built at:** Claude Impact Lab: UCI × SoCal Affordable Housing, November 7, 2026

> **Prototype. Not legal advice.** Pointer explains forms and flags gaps. It never submits,
> emails, signs or files anything. Confirm every decision with the City of Anaheim or a
> professional.

## The real user

A low- or moderate-income homeowner in Anaheim adding an ADU or legalizing an existing unit. They
are doing the forms themselves, often in a second language. They don't know which forms they need,
in what order, or which review track they qualify for. The city's checklist still cites ADU law
by section numbers that were repealed in 2024. This is scenario C01 from the event's Lane 2 data;
**the person is made up.**

**Before:** they download the city's PDF checklist, guess at what each line means, submit, and
wait weeks to learn what was missing. Then they do it again.
**After:** they open the city's checklist in Pointer. A hand points at each item in turn. Every
item is marked complete, missing or unknown. Outdated law is flagged with the current section and
its source. They leave with a readiness report: what is done, what is missing, and what to ask
the city.

## What we built

An editor with the city's real checklist PDF on the left and the homeowner's draft packet on the
right. Next to it, an agent whose every action plays out on screen:

1. **Find the fast path.** A few questions, then "you may qualify for ADU Express". Every answer
   shows the city page it came from and the date it was checked.
2. **Follow it correctly.** The pointer hand walks the checklist one item at a time and explains
   each item in plain language.
3. **Catch problems before the city does.** Missing items turn red. **Law Lens** flags the old
   Gov Code 65852.2 citation and shows the current section range and its source.

The agent can call only five tools: `point_to`, `highlight`, `mark_item`, `draft_field`,
`add_note`. Drafted text appears as a suggestion the homeowner accepts or rejects. There is no
submit button.

**Demo video:** [link, or "uploaded on the hub"]. The script is in
[`docs/pointer-video-script.md`](docs/pointer-video-script.md).
**Live demo:** [optional]

## How Claude is used

- **Building it:** four teams, each with a Claude Code sub-agent working in its own folder against
  shared JSON contracts frozen at 11:55. The plan is in
  [`docs/pointer-adu-copilot-build-plan.md`](docs/pointer-adu-copilot-build-plan.md).
- **Inside the tool:** a Next.js API route runs a Claude tool loop. Claude reads the city's
  checklist config and the HCD ADU Handbook (attached as a PDF, with citations). It names
  checklist **item IDs**, never coordinates. The pointer positions come from boxes computed in
  advance from the PDF's text layer.
- **What a person checks:** every drafted field (accept or reject), every law flag (each one links
  its source), and the readiness report before taking it to the city.

## Try it

You need [Node.js 24 LTS](https://nodejs.org) (pinned in `.nvmrc`) and git. Every dependency is
pinned to an exact version in `package.json` and `package-lock.json`.

```bash
git clone https://github.com/har-m33t/claude-socal-affordable-housing-.git
cd claude-socal-affordable-housing-
nvm install && nvm use          # or install Node 24 another way
npm ci                          # exact versions from the lockfile
cp .env.example .env.local      # then paste your key after ANTHROPIC_API_KEY=
npm run dev                     # open http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm test` | All tests, including the security suite |
| `npm run test:security` | Only `tests/security/` |
| `npm run test:live` | Prompt-injection test against the real Claude API (needs `ANTHROPIC_API_KEY`) |
| `npm run scan:secrets` | Scans git history for keys (needs [gitleaks](https://github.com/gitleaks/gitleaks)) |
| `npm run typecheck` | TypeScript check |

The only environment variable is `ANTHROPIC_API_KEY`. It is read on the server only and never
sent to the browser. No keys are in the repo: `.env*` files are git-ignored, and
`.env.example` lists variable names only.

## Security and privacy

Pointer handles a homeowner's private paperwork and runs an agent. Three things follow from that:
personal data never leaves the browser unredacted, the agent can't act outside the app, and no
claim about the law reaches the screen without a source.

| Threat | Control | Check |
|---|---|---|
| Personal information sent to Claude | `lib/redact/` runs **in the browser** before any request and replaces names, street addresses, phone numbers, emails and APNs with tokens such as `[NAME_1]`. The token map lives only in page memory, never in storage or on the network. Drafts are filled back in locally. A before-and-after panel shows exactly what is sent | `tests/security/redaction*.test.*` |
| Malicious or huge uploads | PDF, PNG and JPEG only, checked by their **file bytes** rather than the extension. 10 MB cap. Filenames sanitized | `tests/security/upload.test.ts` |
| Prompt injection in uploaded files or city PDFs | Document text is wrapped and marked as untrusted data, and the system prompt says to ignore instructions inside documents. Only five tools exist, every argument is schema-checked, and item IDs must exist in the loaded city file | `tests/security/injection.test.ts`, which uses a planted "ignore your rules" PDF |
| Agent acting outside the app | No submit, email, SMS, portal or webhook code exists. A static scan fails the build if any appears, or if a new API route is added without review | `tests/security/no-send.test.ts` |
| Advice for cities nobody has checked | A city whose config says `verified: false` gets "not yet verified" and no advice. Claude is not even called | `tests/security/unverified-city.test.ts` |
| Real personal data committed | Only made-up people are used. A check over `data/`, `fixtures/` and `contracts/` fails on any real-looking email or APN | `tests/security/no-personal-data.test.ts` |
| API key leak | The key is in the server environment only. `.env*` is git-ignored. Gitleaks ran on the full history on 2026-11-07 and found no leaks | `npm run scan:secrets` |
| Supply chain | Exact versions and a lockfile. No unreviewed packages added late | `package-lock.json` |

If Pointer is ever deployed beyond localhost, it needs HTTPS only, CORS locked to its own origin,
and a short privacy notice on the first screen.

## Sources and assumptions

These sources come from the event's Lane 2 data list, checked by the organizers on 2026-11-06.
We re-check each one in a browser before it goes live in the app. **Team 1: replace the dates
below with your own check dates.**

| Item | Source or assumption | Date checked |
|---|---|---|
| Anaheim ADU tracks, including ADU Express (1 to 3 day review) | [ADU Anaheim](https://www.anaheim.net/6349/ADU-Anaheim) | 2026-11-06 (organizers) |
| Anaheim pre-approved plans (4 free plans, 224 to 1,199 sf) | [Pre-Approved Plan Catalogue](https://www.anaheim.net/6351/Pre-Approved-Plan-Catalogue) | 2026-11-06 (organizers) |
| Anaheim checklist items, and its citation of Gov Code 65852.2 and 65852.22 | [ADU Submittal Requirements Checklist, Nov 2025](https://www.anaheim.net/DocumentCenter/View/35053/Accessory-Dwelling-Unit-Submittal-Requirements-Checklist) | 2026-11-06 (organizers) |
| ADU and JADU rules under the current numbering | [HCD ADU Handbook, March 2026](https://www.hcd.ca.gov/sites/default/files/docs/policy-and-research/adu-handbook-update.pdf) ([translations](https://www.hcd.ca.gov/building-standards/adu/handbook)) | 2026-11-06 (organizers) |
| 65852.2 was renumbered to Gov Code 66310 to 66342 (SB 477, 2024). Law Lens shows the **range** unless a specific section is confirmed on leginfo | [Gov Code 66314](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=66314) | 2026-11-06 (organizers) |
| City list for the coverage table (34 OC cities) | Event bundle `lanes/2-clear-it/data/oc-cities.json` | 2026-11-06 (organizers) |
| Irvine ADU review rate, $210.70/hr with a $1,500 deposit (savings formula, Irvine only) | [Irvine fee schedule](https://www.cityofirvine.gov/community-development/fee-schedule) | 2026-11-06 (organizers) |
| `R` correction rounds avoided, `W` weeks per round, `C` weekly carrying cost, `D` design cost avoided | **ASSUMPTION.** No public data on correction rounds was found. The sliders start empty and the homeowner enters them | n/a |
| Anaheim's hourly review rate | **Unknown.** Not checked | n/a |
| Orange County APNs look like `###-###-##` | **ASSUMPTION** used by the redactor. Based on the common OC Assessor format; not checked against every parcel | n/a |
| The applicant, their documents and the planted-injection PDF | **Made up** for testing. Not real people or records | n/a |

## What is real and what is mocked

| Part | Status |
|---|---|
| Anaheim checklist, city page and sources | Real public documents (Team 1 builds `data/cities/anaheim.json`) |
| The other 33 OC cities | Listed on the coverage table as **not yet verified**. They give no advice |
| SB 9 project type | Stub that shows "rules not yet verified" |
| Applicant and their uploaded packet | **Mocked.** Made-up person |
| In-browser redaction, upload checks | Working, with tests |
| Security test suite | Working. The tests that need the agent route skip, with a reason, until that route exists |
| Editor, pointer hand, readiness report (Team 2) | In progress. Driven by `fixtures/mock-events.json` until integration |
| Agent route and tool loop (Team 3) | In progress |
| Agent run during a demo without wifi | Replays a recorded run from `fixtures/replay.json` (Team 3, in progress) |
| Savings sliders | Formula only. Every input except Irvine's rate is an ASSUMPTION |

## Where it gets things wrong

- **Redaction is best-effort.** It uses patterns and a name list, not a trained model. The
  before-and-after panel is there so a person can check what goes out.
  - It misses a name with no label ("Owner:", "Applicant:"), no honorific and no common first
    name, unless the homeowner typed it in. Example: "talked to Okonkwo yesterday".
  - It misses addresses without a house number or street suffix, phone numbers without an area
    code, unlabelled 8-digit APNs, and other identifiers such as birth dates or license numbers.
  - It reads text only, so it misses anything in a scanned image.
  - It over-redacts:
    - Any `###-###-##` number is treated as an APN.
    - Once a name is found, its parts are hidden everywhere: "Testwood Construction" becomes
      "[NAME_3] Construction".
  - When a value appears with different spellings (for example "MARIA EJEMPLO" and "Maria
    Ejemplo"), filling drafts back in uses the first spelling.
- **The upload check is not a malware scanner.** It confirms a file really is a PDF, PNG or JPEG.
  A valid PDF can still be hostile, which is why the viewer runs with PDF scripting off.
- **Scanned PDFs** without a text layer give no text, so they cannot be read or redacted. Pointer
  says so instead of guessing.
- **Law Lens** knows only the mappings in `statutes.json` and the handbook's citations. If a city
  form cites something stale that isn't in that list, Pointer won't flag it.
- **"You may qualify for ADU Express"** is never a yes. The eligibility questions come from the
  city page as of its check date, and the city decides.
- **Unknown stays unknown.** Fees, timelines and rules a source doesn't state show as "unknown".
- We would not trust it yet with a real applicant's documents, any city other than Anaheim, or
  any question about whether a specific project is legal.

## Next steps

- Hand Pointer to Anaheim's permit counter for a pilot with real applicants who opt in. The
  counter also uses Law Lens to find its own outdated forms.
- Each new city is one config file plus a person checking its checklist and recording the date.
  The 34-city table is the roadmap.
- With one more week: Spanish and Vietnamese explanations reviewed by a human (not machine
  translation alone), an SB 9 pack, and a model-based name detector as a second layer behind the
  regex redactor.

## Data and privacy

This project uses only public or provided data. It contains no personal information about real
tenants, buyers or residents; the applicant in the tests and demo is made up. Personal details
are redacted in the browser before anything reaches Claude. Pointer does not file applications
or contact any city or person.

## This repository also contains

Research notes on SoCal affordable housing (`docs/`, `research/`, `data/`) and the Agent Bus that
coordinates Claude Code agents across devices (`scripts/agentbus.py`,
[`docs/agent-protocol.md`](docs/agent-protocol.md), [`docs/agent-workflow.md`](docs/agent-workflow.md)).
Agent rules are in [`AGENTS.md`](AGENTS.md). Run the bus tests with
`python3 -m unittest discover -s tests -v`.

## License

MIT, see [LICENSE](LICENSE).
