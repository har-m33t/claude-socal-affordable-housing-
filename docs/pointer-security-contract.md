# Pointer: what the security tests expect from Teams 1, 2 and 3

Team 4's suites in `tests/security/` already run against reference fixtures. The parts that need
your code **skip with a reason** until your files exist, then run unchanged. If your design differs
from an item below, tell Team 4. The adapter is one file, `tests/security/helpers/route-harness.ts`;
the tests themselves don't change.

Run them with `npm run test:security`.

## Team 3: `app/api/agent/route.ts`

- [ ] Exports `POST(req: Request): Promise<Response>`.
- [ ] **ASSUMPTION, to confirm:** the request body is JSON
  `{ city, type, documents: [{ name, declared_type, text }] }`, and `text` is already redacted in
  the browser.
- [ ] Responds with `content-type: text/event-stream`, one `data: <event JSON>\n\n` frame per
  agent action.
  - Frames that are not actions (done, error) use a named SSE event, such as `event: done`.
- [ ] Every action frame:
  - has `tool` set to one of `point_to`, `highlight`, `mark_item`, `draft_field`, `add_note`;
  - has an `item_id` that exists in the loaded city's checklist;
  - for `mark_item`, has `status` set to `complete`, `missing` or `unknown`.
  - **To confirm:** `add_note` may omit `item_id`, or send `null`, for a general note.
- [ ] Never streams model text that claims an approval or a submission (for example "permit is
  approved" or "I submitted").
- [ ] **Unverified city** (for example `brea`):
  - makes zero requests to Anthropic and zero other outbound requests;
  - returns either an error with no stream, or only `add_note` events saying the city is
    "not yet verified".
- [ ] Calls Claude only through `@anthropic-ai/sdk`:
  - using the default global `fetch`, with no custom `fetch` option;
  - with no `ANTHROPIC_BASE_URL`;
  - with the key from `ANTHROPIC_API_KEY` only.
- [ ] Every Messages request:
  - offers exactly the five tools, all custom, with no server tools and no MCP servers;
  - sets `max_tokens` to an integer of 32000 or less;
  - stays within 25 requests per run, even if the model keeps asking for tools.
- [ ] **Untrusted wrapper:**
  - Document text goes only in `user` turns, inside an XML-style tag (for example
    `<untrusted_document>`) or a `document` content block.
  - The system prompt names that tag and tells the model to ignore any instructions inside
    documents.
  - Escape `<` inside document text, so a document can't close the tag early.
- [ ] No other API routes. Adding one means adding it to the allowlist in
  `tests/security/no-send.test.ts`, on purpose, with a review.

## Team 1: data

- [ ] City files live at `data/cities/<city>.json`.
  - `anaheim.json` has `verified: true`, a `checked_date` in `YYYY-MM-DD`, and at least one
    source.
  - Every other city file has `verified: false`, as a boolean. Files starting with `_`, such as
    `_template.json`, are skipped.
- [ ] Only made-up people. Emails use `@example.com`, phones use 555-0100 to 555-0199, and APNs
  start with `999-`. `tests/security/no-personal-data.test.ts` fails on anything else.

## Team 2: using the redaction module

```ts
import { createRedactor, validateUpload, RedactionPreview } from "@/lib/redact";
```

- **Upload:** call `await validateUpload(file)` first. If it returns `{ ok: false, reason }`, show
  `reason` to the homeowner and stop.
- **Redactor:** create one per browser tab with `createRedactor({ knownNames })`, using the names
  the homeowner typed in.
  - Keep it in a React ref or state, never in storage.
  - Send only `result.text` to the server.
  - Run `restore()` on drafts that come back.
  - Call `clear()` when the homeowner starts over.
- **Preview:** render
  `<RedactionPreview original={text} redacted={result.text} spans={result.spans} />`.
- **PDF viewer:** render with scripting off (`isEvalSupported: false`, and no `enableScripting`).
- **Server code:** don't import `@/lib/redact`. It includes a client component.
