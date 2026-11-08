/**
 * Lane 1: the five agent tool definitions for the Claude tool loop.
 *
 * TOOL_DEFINITIONS is a hand-written array literal in a FIXED order
 * (point_to, highlight, mark_item, draft_field, add_note). Prompt caching is a
 * prefix match over the serialized tools block, so the order must never change
 * at runtime: do not sort this array, do not build it from an object's keys,
 * and do not append to it conditionally.
 *
 * Every definition carries:
 *   - `strict: true`                -> server-side schema guarantees on name/input
 *   - `eager_input_streaming: true` -> input streams as the model generates it
 *
 * `eager_input_streaming` is why lib/agent/validate.ts exists and is not
 * optional. With eager streaming on, the server stops validating tool input and
 * the SDK's tolerant JSON parser can hand the loop a SILENTLY TRUNCATED input
 * object (e.g. a draft_field call with item_id but no text) instead of
 * throwing. Never act on a tool input that has not been through
 * validateToolInput().
 *
 * LAW. The model cannot write law and cannot supply a citation. To refer to a
 * statute it passes `statute_id`, naming a row in the verified statute table;
 * the server resolves that id and renders the authoritative `statute_ref` onto
 * the event. `statute_ref` is therefore never part of any tool input schema,
 * and neither is anything citation-shaped.
 *
 * STRICT MODE. Every property declared on a schema also appears in that
 * schema's `required` array, and a field the model is allowed to leave unset is
 * typed as a nullable union (`["string", "null"]`) rather than omitted from
 * `required`. See the note on OPTIONALITY below.
 */
import type Anthropic from "@anthropic-ai/sdk";

export { validateToolInput } from "./validate";

/**
 * OPTIONALITY. Anthropic's strict mode requires `additionalProperties: false`
 * and a `required` array. It is not settled here whether it also demands that
 * every declared property appear in `required` (the way OpenAI's structured
 * outputs do). Listing every property in `required` and expressing "may be
 * unset" as `["string", "null"]` is valid under both readings, so that is the
 * approach taken on all five tools. The cost is that the model must write an
 * explicit `null`, which is cheap and makes the decision deliberate;
 * validateToolInput() treats `null` in these fields as "not supplied".
 */
const NULLABLE_STRING = ["string", "null"];

/**
 * Appended verbatim to every tool description. The model only reads the
 * description of the tool it picked, so both rules have to be on all five.
 */
const HOUSE_RULES =
  "RULES. (1) `item_id` must be the id of an item that exists in the checklist of " +
  "the city configuration loaded for this run. Ids are not guessable and are not " +
  "shared between cities: use one copied exactly from the loaded checklist. A call " +
  "whose `item_id` is not in that checklist is rejected and the action is dropped. " +
  "(2) Never invent, reconstruct, round or \"correct\" a fee, deadline, date or " +
  "measurement. State only what the loaded city sources actually say. If they do " +
  "not say, the answer is \"unknown\" - say so in plain words, or record it with " +
  "mark_item and status \"unknown\". An unknown is always acceptable; a guess that " +
  "reads like law is not.";

/**
 * Appended to the three tools that can carry legal meaning. This is the single
 * most load-bearing sentence in the product: it is what keeps a hallucinated
 * code section off an applicant's screen.
 */
const LAW_RULE =
  "LAW. Never write a statute number, section number, code citation, numeric " +
  "range, bill number or URL into `text`. Not even one you are sure of, and not " +
  "in parentheses or as an aside. To refer to law, set `statute_id` to the id of " +
  "a row in the statute table you were given, and write `text` as plain prose " +
  "with no numbers in it; the app looks that id up and renders the real citation " +
  "itself. If no row covers the point, or you do not know the id, say the answer " +
  "is unknown and set `statute_id` to null. Text containing law is dropped.";

const ITEM_ID_PROPERTY = {
  type: "string",
  description:
    "The id of a checklist item in the loaded city configuration, copied " +
    "exactly (for example \"owner-affidavit\"). Must already exist in that " +
    "checklist; never invent one.",
};

const STATUTE_ID_PROPERTY = {
  type: NULLABLE_STRING,
  description:
    "The id of a row in the statute table you were given, copied exactly, when " +
    "this action rests on that law. Null when it does not, or when you do not " +
    "know the id. This is a lookup key and nothing else: never put a statute " +
    "number, section, range or URL here, and never guess an id - an id that is " +
    "not in the table is rejected and the whole action is dropped.",
};

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "point_to",
    description:
      "Move the on-screen hand to one checklist item so the applicant's eye goes " +
      "where you are talking. Use this as you start discussing an item. It only " +
      "moves the pointer: it records no judgement about whether the item is " +
      "satisfied - use mark_item for that. " +
      HOUSE_RULES,
    strict: true,
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["item_id"],
      properties: {
        item_id: ITEM_ID_PROPERTY,
      },
    },
  },
  {
    name: "highlight",
    description:
      "Highlight one checklist item to keep it emphasised while you explain it or " +
      "while the applicant works on it. Like point_to, this is presentation only " +
      "and asserts nothing about the item's state. " +
      HOUSE_RULES,
    strict: true,
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["item_id"],
      properties: {
        item_id: ITEM_ID_PROPERTY,
      },
    },
  },
  {
    name: "mark_item",
    description:
      "Record the state of one checklist item: \"complete\" when the submitted " +
      "packet clearly satisfies it, \"missing\" when the packet clearly does not, " +
      "and \"unknown\" when you cannot tell from what you were given. Prefer " +
      "\"unknown\" over a guess - a wrong \"complete\" sends someone to the counter " +
      "with an incomplete application. " +
      LAW_RULE +
      " " +
      HOUSE_RULES,
    strict: true,
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["item_id", "status", "text", "statute_id"],
      properties: {
        item_id: ITEM_ID_PROPERTY,
        text: {
          type: NULLABLE_STRING,
          description:
            "Why, in at most 8 plain words grounded only in the packet (e.g. " +
            "\"No meter spot report in your files\"). Null if there is nothing to add. " +
            "No statute or section numbers, no ranges, no URLs.",
        },
        status: {
          type: "string",
          enum: ["complete", "missing", "unknown"],
          description:
            "\"complete\" = the packet satisfies this item; \"missing\" = it does " +
            "not; \"unknown\" = the loaded sources and packet do not let you tell.",
        },
        statute_id: STATUTE_ID_PROPERTY,
      },
    },
  },
  {
    name: "draft_field",
    description:
      "Propose text for one form field or checklist item. The applicant sees it as " +
      "an accept/reject suggestion and nothing is filled in without their click. " +
      "Draft only from facts the applicant or the loaded sources gave you; leave a " +
      "blank you cannot source as a bracketed placeholder such as " +
      "\"[APN - from your property tax bill]\" rather than filling in a plausible " +
      "value. Max 4000 characters. " +
      LAW_RULE +
      " " +
      HOUSE_RULES,
    strict: true,
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["item_id", "text", "statute_id"],
      properties: {
        item_id: ITEM_ID_PROPERTY,
        text: {
          type: "string",
          description:
            "The proposed text, at most 4000 characters. No statute or section " +
            "numbers, no code citations, no ranges, no bill numbers, no URLs, and " +
            "no invented fees, dates or APNs - use a bracketed placeholder for a " +
            "blank you cannot source, and `statute_id` for law.",
        },
        statute_id: STATUTE_ID_PROPERTY,
      },
    },
  },
  {
    name: "add_note",
    description:
      "Attach a short explanatory note: why an item is needed, what the applicant " +
      "has to go and get, or exactly what is still unknown and who can answer it. " +
      "Use this instead of guessing when the loaded sources are silent. This is " +
      "the one tool whose `item_id` may be null, for a note about the application " +
      "as a whole rather than about a single item; when the note really is about " +
      "one item, name it. Max 4000 characters. " +
      LAW_RULE +
      " " +
      HOUSE_RULES,
    strict: true,
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["item_id", "text", "statute_id"],
      properties: {
        item_id: {
          type: NULLABLE_STRING,
          description:
            "The id of a checklist item in the loaded city configuration, copied " +
            "exactly, when the note is about that item. Null for a note about the " +
            "whole application. Never invent an id: null is correct, a guess is not.",
        },
        text: {
          type: "string",
          description:
            "The note, at most 4000 characters. Say \"unknown\" plainly where the " +
            "loaded sources do not answer the question. No statute or section " +
            "numbers, no code citations, no ranges, no bill numbers and no URLs - " +
            "use `statute_id` for law.",
        },
        statute_id: STATUTE_ID_PROPERTY,
      },
    },
  },
];
