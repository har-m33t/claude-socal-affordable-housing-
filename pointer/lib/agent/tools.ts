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
 */
import type Anthropic from "@anthropic-ai/sdk";

export { validateToolInput } from "./validate";

/**
 * Appended verbatim to every tool description. Two rules the model has to be
 * told plainly on every single tool, because it only reads the one it picked.
 */
const HOUSE_RULES =
  "RULES. (1) `item_id` must be the id of an item that exists in the checklist of " +
  "the city configuration loaded for this run. Ids are not guessable and are not " +
  "shared between cities: use one copied exactly from the loaded checklist. A call " +
  "whose `item_id` is not in that checklist is rejected and the action is dropped. " +
  "(2) Never invent or reconstruct a statute number, code section, fee amount, " +
  "deadline or date, and never round, update or \"correct\" one. State only what the " +
  "loaded city sources actually say. If they do not say, the answer is \"unknown\" - " +
  "say so in plain words, or record it with mark_item and status \"unknown\". " +
  "An unknown is always acceptable; a guess that reads like law is not.";

/**
 * The optional citation every tool may carry. Shared object, but each tool
 * definition references it from its own fixed position, so the serialized
 * prefix stays byte-stable.
 */
const CITATION_PROPERTY = {
  type: "object",
  description:
    "Where this came from. Attach it whenever the action repeats or relies on " +
    "something a city source says. Use only a URL from the loaded city " +
    "configuration's sources or from the checklist item itself - never a URL from " +
    "memory.",
  additionalProperties: false,
  required: ["source_url", "checked_date"],
  properties: {
    source_url: {
      type: "string",
      description:
        "The source URL, copied exactly from the loaded city configuration.",
    },
    checked_date: {
      type: "string",
      description:
        "The date that source was last checked by a person, as YYYY-MM-DD, " +
        "copied from the loaded city configuration. Do not use today's date and " +
        "do not estimate it.",
    },
    detail: {
      type: "string",
      description:
        "Optional pin-point inside the source: a section number, page number or " +
        "a short quoted line. Quote it; do not paraphrase it. Max 500 characters.",
    },
  },
};

const ITEM_ID_PROPERTY = {
  type: "string",
  description:
    "The id of a checklist item in the loaded city configuration, copied " +
    "exactly (for example \"owner-affidavit\"). Must already exist in that " +
    "checklist; never invent one.",
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
        citation: CITATION_PROPERTY,
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
        citation: CITATION_PROPERTY,
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
      HOUSE_RULES,
    strict: true,
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["item_id", "status"],
      properties: {
        item_id: ITEM_ID_PROPERTY,
        status: {
          type: "string",
          enum: ["complete", "missing", "unknown"],
          description:
            "\"complete\" = the packet satisfies this item; \"missing\" = it does " +
            "not; \"unknown\" = the loaded sources and packet do not let you tell.",
        },
        citation: CITATION_PROPERTY,
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
      HOUSE_RULES,
    strict: true,
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["item_id", "text"],
      properties: {
        item_id: ITEM_ID_PROPERTY,
        text: {
          type: "string",
          description:
            "The proposed text, at most 4000 characters. No invented statute " +
            "numbers, fees, dates or APNs - use a bracketed placeholder instead.",
        },
        citation: CITATION_PROPERTY,
      },
    },
  },
  {
    name: "add_note",
    description:
      "Attach a short explanatory note to one checklist item: why it is needed, " +
      "what the applicant has to go and get, or exactly what is still unknown and " +
      "who can answer it. Use this instead of guessing when the loaded sources are " +
      "silent. Max 4000 characters. " +
      HOUSE_RULES,
    strict: true,
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["item_id", "text"],
      properties: {
        item_id: ITEM_ID_PROPERTY,
        text: {
          type: "string",
          description:
            "The note, at most 4000 characters. Say \"unknown\" plainly where the " +
            "loaded sources do not answer the question; never fill the gap with a " +
            "statute, section, fee or date from memory.",
        },
        citation: CITATION_PROPERTY,
      },
    },
  },
];
