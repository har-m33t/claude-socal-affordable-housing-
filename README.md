# Pointer

An ADU permit copilot. Pointer walks a homeowner through their city's real paperwork, step by
step, points at exactly what each step needs, and answers questions from the documents
themselves.

Anaheim, California is fully supported. The other 33 Orange County cities are listed and say
"not yet verified" until someone reads their checklist.

> Prototype. Not legal advice. Pointer explains forms and flags gaps; it never files, signs or
> sends anything.

## Features

- **Plan pointer.** A 13-step plan across the city's real documents: the submittal checklist,
  the ADU Express Application (field by field), the impact-fee sheet, and your own files.
  Claude checks your packet live, and a terracotta cursor moves through each step, marking it
  complete, missing or unknown.
- **Answer pointer.** Ask a question and a blue cursor jumps to the line that answers it, on
  whichever document holds it, quoting the city's own words with the source. If the documents
  don't cover it, Pointer says so instead of guessing.
- **Law Lens.** Flags city documents that cite outdated state law, for example Gov. Code
  65852.2 (renumbered to 66310–66342) and 66324 (now 66311.5), and links the source.
- **Voice and languages.** Ask out loud, and get replies translated and read back in Español,
  Tiếng Việt, 中文 or 한국어. Speech and translation run on-device in Chrome.
- **Private by design.** Uploaded files are read and redacted in the browser (names,
  addresses, phones, emails, parcel numbers) before anything is sent to Claude.
- **Readiness report.** What's done, what's missing, what to ask the city, with every source.

## Quick start

Requires Node 24 (see `.nvmrc`).

```bash
npm ci
cp .env.example .env.local    # add ANTHROPIC_API_KEY
npm run dev                   # http://localhost:3000
```

Without a key, the documents, the Ask tab and the file board still work; live packet checks
need `ANTHROPIC_API_KEY`. See `.env.example` for optional limits.

```bash
npm test             # unit, integration and security tests
npm run typecheck
```

## How it works

- `data/plans/anaheim-adu.json`: the plan. Every pointer target is a verbatim quote with its
  page and box, measured from the city's PDFs, which live in `data/docs/`.
- `app/api/agent/`, `lib/agent/`: a Claude tool loop with exactly five tools (`point_to`,
  `highlight`, `mark_item`, `draft_field`, `add_note`), streamed to the browser as server-sent
  events. Every argument is validated, item ids must exist in the plan, law reaches the screen
  only from a confirmed statute table, and document text is treated as untrusted.
- `components/stage/`, `components/sidebar/`: the document viewer with both cursors, and the
  Plan / Ask sidebar.
- `lib/redact/`, `lib/voice/`, `lib/i18n/`: in-browser redaction, voice input, translation.

Sources and their check dates are in [`research/sources.md`](research/sources.md).

## Limitations

- Only Anaheim ADUs are verified. Other cities and project types give no advice.
- Redaction is pattern-based: it can miss an unlabelled name and can't read scanned images.
- Translations are machine translations; the English is the official text.
- Voice input and translation need a recent Chrome. Read-aloud needs a voice for the chosen
  language on your device.

## Also in this repo

Research notes on SoCal affordable housing (`docs/`, `research/`) and a small protocol for
coordinating AI agents across machines over GitHub Issues (`scripts/agentbus.py`,
[`docs/agent-protocol.md`](docs/agent-protocol.md)).

## License

[MIT](LICENSE)
