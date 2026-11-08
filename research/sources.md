# Sources

Track every dataset, report, and article used. Add the date you accessed it.

## Data

| Source | What it covers | Link | Accessed |
|---|---|---|---|
| HUD Income Limits | Area Median Income (AMI) and income limits by county | https://www.huduser.gov/portal/datasets/il.html | |
| HUD LIHTC Database | Low-Income Housing Tax Credit properties | https://www.huduser.gov/portal/datasets/lihtc.html | |
| CA HCD Annual Progress Reports | Housing Element / RHNA progress by jurisdiction | https://www.hcd.ca.gov/planning-and-community-development/annual-progress-reports | |
| SCAG RHNA | 6th cycle regional housing needs allocation | https://scag.ca.gov/rhna | |
| U.S. Census ACS | Rent burden, household income, tenure | https://data.census.gov | |

## Reports and articles

| Title | Author / Org | Link | Accessed | Notes |
|---|---|---|---|---|
| | | | | |

## ADU permitting — Orange County

Collected for Pointer, the ADU permit copilot in this repo. These rows come from a sourced data
list compiled by third parties on 2026-11-06. **Not independently re-opened** — the status column is that list's check, not ours.
`VERIFIED-EXA` means a plain fetch was blocked (403) and the content was confirmed by another tool;
the page opens normally in a browser.

| Source | What it covers | Link | Checked | Status |
|---|---|---|---|---|
| Anaheim: ADU Anaheim | Three review tracks, including ADU Express (1 to 3 day review) | https://www.anaheim.net/6349/ADU-Anaheim | 2026-11-06 | VERIFIED-EXA (organizers) |
| Anaheim: Pre-Approved Plan Catalogue | 4 free city plans, 224 to 1,199 sf | https://www.anaheim.net/6351/Pre-Approved-Plan-Catalogue | 2026-11-06 | VERIFIED-EXA (organizers) |
| Anaheim: ADU Submittal Requirements Checklist (Nov 2025) | Sewer capacity verification, meter location, new address, JADU covenant. Still cites repealed Gov Code 65852.2 and 65852.22 | https://www.anaheim.net/DocumentCenter/View/35053/Accessory-Dwelling-Unit-Submittal-Requirements-Checklist | 2026-11-06 | VERIFIED-EXA (organizers) |
| HCD ADU Handbook (March 2026) | ADU and JADU rules under the current numbering; changes 2022 to 2026 | https://www.hcd.ca.gov/sites/default/files/docs/policy-and-research/adu-handbook-update.pdf | 2026-11-06 | VERIFIED (organizers) |
| HCD ADU Handbook landing page | Handbook plus ES, VI, ZH translations | https://www.hcd.ca.gov/building-standards/adu/handbook | 2026-11-06 | VERIFIED (organizers) |
| Gov Code 66314 (ADU approvals) | ADU approval standards. **Correction:** the organizers' list attached the 60-day approve-or-deny deadline to this section; the HCD Handbook cites **66317(a)(3)** for it. See the Team 1 rows below. | https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=66314 | 2026-11-06 | VERIFIED-EXA (organizers), partly superseded |
| Irvine: Project: Constructing an ADU | Submittal list (verification form, covenant, hold harmless, school fee, TCA form); ~2-business-day completeness check | https://cityofirvine.gov/building-permits-and-inspections/project-constructing-accessory-dwelling-unit-adu | 2026-11-06 | VERIFIED (organizers) |
| Irvine: Fee Schedule | ADU planning review billed hourly: $210.70/hr, $1,500 deposit. Fees rose 2025-08-15 | https://www.cityofirvine.gov/community-development/fee-schedule | 2026-11-06 | VERIFIED (organizers) |
| Garden Grove: ADU Go | Pre-approved program, 4 free city plans, applications via GG Ready | https://ggcity.org/adu-go | 2026-11-06 | VERIFIED (organizers) |

**Statute renumbering, per the same list:** SB 477 (March 2024) moved ADU law from Gov Code 65852.2
to the range **66310 to 66342**; approvals are 66314 to 66331 and JADU is 66333. Old numbers still
appear in live city documents. Confirm any specific section on leginfo before building a rule on it.

### Read first-hand by Team 1 (2026-11-07)

These rows are **stronger than the organizers' list above**: Team 1 downloaded
each source into `data/raw/` on 2026-11-07, read it, and quoted it. Page anchors
point at the exact page. Reviewed and confirmed by the Team 1 lead the same day.
Compiled on branch `agent/data/pointer-data`; see its `data/README.md` for the
rebuild commands.

| Source | What it establishes | Link | Accessed | Status |
|---|---|---|---|---|
| HCD ADU Handbook (March 2026), p. 11 | The 60-day approve-or-deny clock for an ADU/JADU application on a lot with an existing dwelling, cited to **Gov Code 66317(a)(3)** | https://www.hcd.ca.gov/sites/default/files/docs/policy-and-research/adu-handbook-update.pdf#page=11 | 2026-11-07 | VERIFIED (read first-hand) |
| HCD ADU Handbook, p. 13 | SB 477 (Ch. 7, Stats. 2024) renumbered 65852.2, 65852.22, 65852.23 **and** 65852.26 to the whole range **66310-66342**. Also: ADU approval standards sit at 66314-66331, and local pre-approved-plan programs were required by 2025-01-01 | https://www.hcd.ca.gov/sites/default/files/docs/policy-and-research/adu-handbook-update.pdf#page=13 | 2026-11-07 | VERIFIED (read first-hand) |
| HCD ADU Handbook, p. 14 | 2025 renumbering of 66324, 66327 and 66332 to **66311.5, 66313.5 and 66311.7**. Also: JADU owner occupancy is required **only** where the JADU shares sanitation facilities with the primary structure (66333(b)) | https://www.hcd.ca.gov/sites/default/files/docs/policy-and-research/adu-handbook-update.pdf#page=14 | 2026-11-07 | VERIFIED (read first-hand) |
| HCD ADU Handbook, p. 16 | JADU provisions sit at **66333-66339** | https://www.hcd.ca.gov/sites/default/files/docs/policy-and-research/adu-handbook-update.pdf#page=16 | 2026-11-07 | VERIFIED (read first-hand) |
| HCD ADU Handbook landing page | The Handbook plus ES, VI and ZH translations | https://www.hcd.ca.gov/building-standards/adu/handbook | 2026-11-07 | VERIFIED (read first-hand) |
| Anaheim: Pre-Approved Plan Catalogue | Anaheim's pre-approved plan program. Eligibility screening "can take a few weeks" | https://www.anaheim.net/6351/Pre-Approved-Plan-Catalogue | 2026-11-07 | VERIFIED (read first-hand) |
| Anaheim: ADU Anaheim | ADU Express "allows qualified single-family properties to complete the ADU review process within 1-3 days" | https://www.anaheim.net/6349/ADU-Anaheim | 2026-11-07 | VERIFIED (read first-hand) |
| Anaheim: ADU Submittal Requirements Checklist (Nov 2025) | Six submittal items, each with its page and bounding box in the PDF text layer. Still cites the repealed 65852.2 and 65852.22 | https://www.anaheim.net/DocumentCenter/View/35053/Accessory-Dwelling-Unit-Submittal-Requirements-Checklist | 2026-11-07 | VERIFIED (read first-hand) |

#### Corrections this made to the organizers' list

1. **The 60-day deadline is Gov Code 66317(a)(3), not 66314** (Handbook p. 11).
2. **The Handbook never maps 65852.22 to 66333 alone.** It maps all four old
   sections to the whole range 66310-66342 (p. 13); JADU law is 66333-66339
   (p. 16). Any Law Lens display must therefore show the range, not a single
   section.

#### Where Anaheim's own documents disagree

Three conflicts quoted on both sides, all confirmed 2026-11-07. Recorded as data
(`data/law-flags.json`), and never to be presented as legal advice — the app says
"may be out of date, confirm with the city".

| Conflict | Anaheim says | Current source says |
|---|---|---|
| JADU covenant citation | "authorized by the California Government Code Sections 65852.2 and 65852.22" | Renumbered by SB 477 (2024) to 66310-66342 (Handbook p. 13) |
| JADU owner occupancy | AMC 18.38.015.110 requires an owner-occupancy covenant "for all JADUs" | Required only where the JADU shares sanitation facilities with the primary structure (66333(b), Handbook p. 14) |
| ADU Express timing | Nov 2025 checklist: "one day permitting and zero design costs" | ADU Anaheim page: "within 1-3 days", and the Catalogue page adds that eligibility screening "can take a few weeks" |

