import { describe, expect, it } from "vitest";

import mockCityJson from "../../fixtures/mock-city.json";
import mockCityUnverifiedJson from "../../fixtures/mock-city-unverified.json";
import anaheimJson from "../../data/cities/anaheim.json";
import * as toolsModule from "../../lib/agent/tools";
import { TOOL_DEFINITIONS, validateToolInput } from "../../lib/agent/tools";
import { TOOL_NAMES, type CityConfig, type ToolsModule } from "../../lib/agent/types";

const city = mockCityJson as unknown as CityConfig;
const unverifiedCity = mockCityUnverifiedJson as unknown as CityConfig;
const anaheim = anaheimJson as unknown as CityConfig;

/** Compile-time proof that lib/agent/tools.ts satisfies the frozen contract. */
const _contract: ToolsModule = toolsModule;
void _contract;

/** The three tools that may carry legal meaning, and so declare statute_id. */
const LAW_TOOLS = ["mark_item", "draft_field", "add_note"] as const;
/** The two pure-pointing tools, which must not. */
const POINTING_TOOLS = ["point_to", "highlight"] as const;

type Result = ReturnType<typeof validateToolInput>;

function ok(result: Result) {
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);
  return result;
}

function err(result: Result) {
  if (result.ok) throw new Error(`expected failure, got event: ${JSON.stringify(result.event)}`);
  return result.error;
}

function propertiesOf(name: string): Record<string, { type?: unknown; enum?: string[] }> {
  const tool = TOOL_DEFINITIONS.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool named ${name}`);
  return tool.input_schema["properties"] as Record<string, { type?: unknown; enum?: string[] }>;
}

/** A minimal valid input for each tool, used by the placement tests. */
function baseInput(name: string): Record<string, unknown> {
  switch (name) {
    case "mark_item":
      return { item_id: "item-1", status: "complete" };
    case "draft_field":
    case "add_note":
      return { item_id: "item-1", text: "hello" };
    default:
      return { item_id: "item-1" };
  }
}

/** Every key appearing anywhere in a JSON schema, at any depth. */
function schemaKeys(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) schemaKeys(child, found);
  } else if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      found.push(key);
      schemaKeys(value, found);
    }
  }
  return found;
}

describe("TOOL_DEFINITIONS", () => {
  it("exports exactly five tools in the frozen order", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(5);
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toEqual([
      "point_to",
      "highlight",
      "mark_item",
      "draft_field",
      "add_note",
    ]);
  });

  it("matches TOOL_NAMES from the frozen contract", () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toEqual([...TOOL_NAMES]);
  });

  it("is stable across reads (never sorted or rebuilt at runtime)", () => {
    const first = TOOL_DEFINITIONS.map((t) => t.name).join(",");
    const second = TOOL_DEFINITIONS.map((t) => t.name).join(",");
    expect(second).toBe(first);
  });

  it.each(TOOL_DEFINITIONS.map((t) => [t.name, t] as const))(
    "%s is strict, eager-streaming, and closed to extra properties",
    (_name, tool) => {
      expect(tool.strict).toBe(true);
      expect(tool.eager_input_streaming).toBe(true);
      expect(tool.input_schema.type).toBe("object");
      expect(tool.input_schema["additionalProperties"]).toBe(false);
      expect(Array.isArray(tool.input_schema.required)).toBe(true);
      expect(tool.input_schema.required?.length).toBeGreaterThan(0);
    },
  );

  it.each(TOOL_DEFINITIONS.map((t) => [t.name, t] as const))(
    "%s lists every declared property in required (strict-mode choice)",
    (_name, tool) => {
      const properties = tool.input_schema["properties"] as Record<string, unknown>;
      // We express "may be unset" as a nullable union rather than by omitting
      // the field from `required`, so the two sets must match exactly.
      expect([...(tool.input_schema.required ?? [])].sort()).toEqual(
        Object.keys(properties).sort(),
      );
    },
  );

  it.each(TOOL_DEFINITIONS.map((t) => [t.name, t] as const))(
    "%s declares the correct required array",
    (name, tool) => {
      const expected: Record<string, string[]> = {
        point_to: ["item_id"],
        highlight: ["item_id"],
        mark_item: ["item_id", "status", "text", "statute_id"],
        draft_field: ["item_id", "text", "statute_id"],
        add_note: ["item_id", "text", "statute_id"],
      };
      expect(tool.input_schema.required).toEqual(expected[name]);
    },
  );

  it.each(TOOL_DEFINITIONS.map((t) => [t.name, t] as const))(
    "%s declares no citation and no statute_ref field, at any depth",
    (_name, tool) => {
      // The word "citation" may legitimately appear inside a prohibition in a
      // description ("no code citations"); what must never exist is a FIELD the
      // model could fill in. So check the schema's keys, not its prose.
      expect(schemaKeys(tool.input_schema)).not.toContain("citation");
      expect(schemaKeys(tool.input_schema)).not.toContain("statute_ref");
      expect(JSON.stringify(tool.input_schema)).not.toMatch(/"citation"\s*:/);
      expect(JSON.stringify(tool.input_schema)).not.toMatch(/statute_ref/i);
    },
  );

  it("never offers the model a statute_ref field, on any tool, at any depth", () => {
    expect(JSON.stringify(TOOL_DEFINITIONS)).not.toMatch(/statute_ref/i);
  });

  it.each(LAW_TOOLS)("%s declares an optional nullable statute_id", (name) => {
    const properties = propertiesOf(name);
    expect(properties).toHaveProperty("statute_id");
    expect(properties.statute_id?.type).toEqual(["string", "null"]);
  });

  it.each(POINTING_TOOLS)("%s declares no statute_id - it is pure pointing", (name) => {
    expect(Object.keys(propertiesOf(name))).toEqual(["item_id"]);
  });

  it("requires a non-null item_id on every tool but add_note", () => {
    for (const name of ["point_to", "highlight", "mark_item", "draft_field"]) {
      expect(propertiesOf(name).item_id?.type).toBe("string");
    }
  });

  it("lets add_note carry a null item_id", () => {
    expect(propertiesOf("add_note").item_id?.type).toEqual(["string", "null"]);
  });

  it("constrains mark_item status to the three allowed values", () => {
    expect(propertiesOf("mark_item").status?.enum).toEqual(["complete", "missing", "unknown"]);
  });
});

describe("tool descriptions", () => {
  it.each(TOOL_DEFINITIONS.map((t) => [t.name, t] as const))(
    "%s tells the model item_id must exist in the loaded checklist, and not to invent facts",
    (_name, tool) => {
      const description = tool.description ?? "";
      expect(description.length).toBeGreaterThan(80);
      expect(description).toContain("item_id");
      expect(description).toMatch(/checklist of the city configuration loaded/i);
      expect(description).toMatch(/never invent/i);
      expect(description).toMatch(/fee/i);
      expect(description).toMatch(/date/i);
      expect(description).toMatch(/unknown/i);
    },
  );

  it.each(LAW_TOOLS)("%s forbids writing law in text and points at statute_id instead", (name) => {
    const description = TOOL_DEFINITIONS.find((t) => t.name === name)?.description ?? "";
    expect(description).toMatch(/never write a statute number/i);
    expect(description).toMatch(/section number/i);
    expect(description).toMatch(/code citation/i);
    expect(description).toMatch(/range/i);
    expect(description).toMatch(/bill number/i);
    expect(description).toMatch(/URL/);
    expect(description).toMatch(/statute_id/);
    // And it says what to do when there is no id: answer unknown.
    expect(description).toMatch(/do not know the id/i);
    expect(description).toMatch(/unknown/i);
  });

  it("never instructs the model to supply a citation", () => {
    for (const tool of TOOL_DEFINITIONS) {
      const description = tool.description ?? "";
      expect(description).not.toMatch(
        /(attach|supply|include|provide|add|set|pass|write)\s+(a|the|an)?\s*citation/i,
      );
      // Where "citation" appears at all, it must be inside a prohibition.
      for (const sentence of description.split(/(?<=\.)\s+/)) {
        if (/citation/i.test(sentence)) {
          expect(sentence).toMatch(/\bnever\b|\bno\b|\bnot\b/i);
        }
      }
    }
  });
});

describe("validateToolInput - happy path", () => {
  it("accepts point_to", () => {
    const { event } = ok(validateToolInput("point_to", { item_id: "item-1" }, city));
    expect(event.tool).toBe("point_to");
    expect(event.item_id).toBe("item-1");
    expect(event.status).toBeUndefined();
    expect(event.text).toBeUndefined();
    expect(new Date(event.ts).toISOString()).toBe(event.ts);
  });

  it("accepts highlight", () => {
    const { event } = ok(validateToolInput("highlight", { item_id: "item-2" }, city));
    expect(event.tool).toBe("highlight");
    expect(event.item_id).toBe("item-2");
  });

  it("accepts mark_item with each valid status", () => {
    for (const status of ["complete", "missing", "unknown"] as const) {
      const { event } = ok(validateToolInput("mark_item", { item_id: "item-3", status }, city));
      expect(event.tool).toBe("mark_item");
      expect(event.status).toBe(status);
    }
  });

  it("accepts draft_field", () => {
    const { event } = ok(
      validateToolInput("draft_field", { item_id: "item-4", text: "Owner: [YOUR NAME]" }, city),
    );
    expect(event.tool).toBe("draft_field");
    expect(event.text).toBe("Owner: [YOUR NAME]");
  });

  it("accepts add_note", () => {
    const { event } = ok(
      validateToolInput("add_note", { item_id: "item-1", text: "Unknown - ask the counter." }, city),
    );
    expect(event.tool).toBe("add_note");
    expect(event.text).toBe("Unknown - ask the counter.");
  });

  it("accepts text of exactly 4000 characters", () => {
    const text = "x".repeat(4000);
    const { event } = ok(validateToolInput("draft_field", { item_id: "item-1", text }, city));
    expect(event.text).toHaveLength(4000);
  });

  it("produces an event that serializes without undefined keys", () => {
    const { event } = ok(validateToolInput("point_to", { item_id: "item-1" }, city));
    expect(Object.keys(JSON.parse(JSON.stringify(event))).sort()).toEqual([
      "item_id",
      "tool",
      "ts",
    ]);
  });

  it("accepts the real city config, whose items now carry a page and a box", () => {
    const firstItem = anaheim.checklist[0]!;
    // Team 1 extracted these from the November 2025 PDF text layer, so the
    // pointer hand finally has somewhere to point.
    expect(firstItem.page).toEqual(expect.any(Number));
    expect(firstItem.box).toHaveLength(4);
    const { event } = ok(
      validateToolInput("add_note", { item_id: firstItem.id, text: "note" }, anaheim),
    );
    expect(event.item_id).toBe(firstItem.id);
  });
});

describe("validateToolInput - add_note without an item", () => {
  it("accepts add_note with no item_id at all", () => {
    const { event } = ok(validateToolInput("add_note", { text: "General note." }, city));
    expect(event.tool).toBe("add_note");
    expect(event.text).toBe("General note.");
    expect("item_id" in event).toBe(false);
    expect(Object.keys(JSON.parse(JSON.stringify(event))).sort()).toEqual(["text", "tool", "ts"]);
  });

  it("accepts add_note with item_id: null", () => {
    const { event } = ok(
      validateToolInput("add_note", { item_id: null, text: "General note." }, city),
    );
    expect("item_id" in event).toBe(false);
  });

  it("accepts add_note with item_id: null and a statute_id", () => {
    const result = ok(
      validateToolInput(
        "add_note",
        { item_id: null, text: "The rules changed this year.", statute_id: "ab-1033" },
        city,
      ),
    );
    expect(result.statute_id).toBe("ab-1033");
    expect("item_id" in result.event).toBe(false);
  });

  it("still rejects an add_note whose item_id is supplied but unknown", () => {
    expect(err(validateToolInput("add_note", { item_id: "item-99", text: "x" }, city))).toMatch(
      /unknown item_id/i,
    );
  });

  it.each(["point_to", "highlight", "mark_item", "draft_field"])(
    "rejects %s with no item_id",
    (name) => {
      const input = baseInput(name);
      delete input.item_id;
      expect(err(validateToolInput(name, input, city))).toMatch(/"item_id" is required/);
    },
  );

  it.each(["point_to", "highlight", "mark_item", "draft_field"])(
    "rejects %s with item_id: null",
    (name) => {
      const input = { ...baseInput(name), item_id: null };
      expect(err(validateToolInput(name, input, city))).toMatch(/"item_id" is required/);
    },
  );
});

describe("validateToolInput - statute_id", () => {
  it.each(LAW_TOOLS)("accepts a statute_id on %s and returns it beside the event", (name) => {
    const result = ok(
      validateToolInput(name, { ...baseInput(name), statute_id: "ab-1033" }, city),
    );
    expect(result.statute_id).toBe("ab-1033");
  });

  it.each(LAW_TOOLS)("never writes statute_id or statute_ref onto the %s event", (name) => {
    const result = ok(
      validateToolInput(name, { ...baseInput(name), statute_id: "ab-1033" }, city),
    );
    expect("statute_id" in result.event).toBe(false);
    expect(result.event.statute_ref).toBeUndefined();
    expect(JSON.stringify(result.event)).not.toMatch(/statute/i);
  });

  it.each(LAW_TOOLS)("treats statute_id: null on %s as not supplied", (name) => {
    const result = ok(validateToolInput(name, { ...baseInput(name), statute_id: null }, city));
    expect(result.statute_id).toBeUndefined();
  });

  it.each(LAW_TOOLS)("omits statute_id from the %s result when absent", (name) => {
    const result = ok(validateToolInput(name, baseInput(name), city));
    expect("statute_id" in result).toBe(false);
  });

  it.each(LAW_TOOLS)("trims a padded statute_id on %s", (name) => {
    const result = ok(
      validateToolInput(name, { ...baseInput(name), statute_id: "  ab-1033\n" }, city),
    );
    expect(result.statute_id).toBe("ab-1033");
  });

  it.each(POINTING_TOOLS)("rejects statute_id on %s", (name) => {
    const message = err(
      validateToolInput(name, { ...baseInput(name), statute_id: "ab-1033" }, city),
    );
    expect(message).toMatch(/"statute_id" is only allowed/);
    expect(message).toMatch(/mark_item, draft_field and add_note/);
  });

  it.each(POINTING_TOOLS)("rejects even a null statute_id on %s", (name) => {
    expect(
      err(validateToolInput(name, { ...baseInput(name), statute_id: null }, city)),
    ).toMatch(/"statute_id" is only allowed/);
  });

  it.each(LAW_TOOLS)("rejects an empty or whitespace-only statute_id on %s", (name) => {
    for (const statute_id of ["", "   ", "\t\n"]) {
      expect(err(validateToolInput(name, { ...baseInput(name), statute_id }, city))).toMatch(
        /statute_id/,
      );
    }
  });

  it.each(LAW_TOOLS)("rejects an over-length statute_id on %s", (name) => {
    const statute_id = "a".repeat(121);
    const message = err(validateToolInput(name, { ...baseInput(name), statute_id }, city));
    expect(message).toMatch(/statute_id/);
    expect(message).toMatch(/120/);
  });

  it.each(LAW_TOOLS)("accepts a statute_id of exactly 120 characters on %s", (name) => {
    const statute_id = "a".repeat(120);
    expect(ok(validateToolInput(name, { ...baseInput(name), statute_id }, city)).statute_id)
      .toHaveLength(120);
  });

  it.each(LAW_TOOLS)("rejects a wrongly typed statute_id on %s", (name) => {
    for (const statute_id of [7, true, ["ab-1033"], { id: "ab-1033" }]) {
      expect(err(validateToolInput(name, { ...baseInput(name), statute_id }, city))).toMatch(
        /statute_id/,
      );
    }
  });

  it("does not resolve a statute_id - an unknown id still passes shape validation", () => {
    // Resolution is verifier.ts's job (resolveStatuteId), which fails closed.
    // This function only checks that the key looks like a key.
    const result = ok(
      validateToolInput(
        "mark_item",
        { item_id: "item-1", status: "unknown", statute_id: "no-such-row-anywhere" },
        city,
      ),
    );
    expect(result.statute_id).toBe("no-such-row-anywhere");
  });
});

describe("validateToolInput - rejections", () => {
  it("rejects an unknown tool name", () => {
    expect(err(validateToolInput("open_the_pod_bay_doors", { item_id: "item-1" }, city))).toMatch(
      /unknown tool/i,
    );
  });

  it("rejects an item_id that is not in the city checklist", () => {
    const message = err(validateToolInput("point_to", { item_id: "item-99" }, city));
    expect(message).toMatch(/unknown item_id/i);
    expect(message).toContain("item-99");
  });

  it("rejects an item_id borrowed from another city", () => {
    // "sewer-capacity-verification" exists in Anaheim, not in the fixture city.
    expect(
      err(validateToolInput("highlight", { item_id: "sewer-capacity-verification" }, city)),
    ).toMatch(/unknown item_id/i);
  });

  it("rejects an item_id missing from a sparse (unverified) city", () => {
    expect(err(validateToolInput("point_to", { item_id: "item-4" }, unverifiedCity))).toMatch(
      /unknown item_id/i,
    );
    // item-1 does exist there, so the guard is checking membership, not refusing wholesale.
    expect(
      ok(validateToolInput("point_to", { item_id: "item-1" }, unverifiedCity)).event.item_id,
    ).toBe("item-1");
  });

  it("rejects a mark_item with a bad status", () => {
    expect(
      err(validateToolInput("mark_item", { item_id: "item-1", status: "COMPLETE" }, city)),
    ).toMatch(/status/i);
    expect(
      err(validateToolInput("mark_item", { item_id: "item-1", status: "probably-fine" }, city)),
    ).toMatch(/status/i);
  });

  it("rejects a draft_field whose text exceeds 4000 characters", () => {
    const message = err(
      validateToolInput("draft_field", { item_id: "item-1", text: "x".repeat(4001) }, city),
    );
    expect(message).toMatch(/text/i);
  });

  it("rejects a truncated input object from the eager-streaming parser", () => {
    // draft_field requires text; the tolerant parser can hand back only item_id.
    expect(err(validateToolInput("draft_field", { item_id: "item-1" }, city))).toMatch(/text/i);
    expect(err(validateToolInput("add_note", { item_id: "item-1" }, city))).toMatch(/text/i);
    // mark_item requires status.
    expect(err(validateToolInput("mark_item", { item_id: "item-1" }, city))).toMatch(/status/i);
    // Even item_id can be lost.
    expect(err(validateToolInput("point_to", {}, city))).toMatch(/item_id/i);
    // add_note survives a lost item_id, but not a lost text.
    expect(err(validateToolInput("add_note", {}, city))).toMatch(/text/i);
  });

  it("rejects status supplied to point_to", () => {
    const message = err(
      validateToolInput("point_to", { item_id: "item-1", status: "complete" }, city),
    );
    expect(message).toMatch(/status/i);
    expect(message).toMatch(/mark_item/);
  });

  it("rejects status supplied to highlight, draft_field and add_note", () => {
    for (const name of ["highlight", "draft_field", "add_note"]) {
      const input: Record<string, unknown> = { ...baseInput(name), status: "complete" };
      expect(err(validateToolInput(name, input, city))).toMatch(/"status" is only allowed/);
    }
  });

  it("rejects text supplied to point_to and highlight", () => {
    expect(err(validateToolInput("point_to", { item_id: "item-1", text: "hi" }, city))).toMatch(
      /"text" is only allowed/,
    );
    expect(err(validateToolInput("highlight", { item_id: "item-1", text: "hi" }, city))).toMatch(
      /"text" is only allowed/,
    );
  });

  it("accepts a short status reason on mark_item, treats null as none, and caps its length", () => {
    const ok = validateToolInput("mark_item", { item_id: "item-1", status: "missing", text: "No meter spot report in your files" }, city);
    expect(ok.ok && ok.event.text).toBe("No meter spot report in your files");
    const none = validateToolInput("mark_item", { item_id: "item-1", status: "complete", text: null, statute_id: null }, city);
    expect(none.ok && "text" in none.event).toBe(false);
    expect(err(validateToolInput("mark_item", { item_id: "item-1", status: "complete", text: "x".repeat(201) }, city))).toBeTruthy();
  });

  it("rejects a model-supplied citation as an unrecognized key", () => {
    // The model has no citation channel any more: law travels only as a
    // server-rendered statute_ref resolved from statute_id.
    for (const name of TOOL_NAMES) {
      const input = {
        ...baseInput(name),
        citation: { source_url: "https://example.invalid/x", checked_date: "2026-11-07" },
      };
      expect(err(validateToolInput(name, input, city))).toMatch(/unrecognized/i);
    }
  });

  it("rejects a model-supplied statute_ref as an unrecognized key", () => {
    for (const name of TOOL_NAMES) {
      const input = { ...baseInput(name), statute_ref: { id: "ab-1033", old: "x" } };
      expect(err(validateToolInput(name, input, city))).toMatch(/unrecognized/i);
    }
  });

  it("rejects extra keys the model made up", () => {
    expect(
      err(validateToolInput("point_to", { item_id: "item-1", page: 3, box: [1, 2, 3, 4] }, city)),
    ).toMatch(/unrecognized/i);
  });

  it("rejects input that is not an object", () => {
    for (const bad of [null, undefined, "item-1", 7, [{ item_id: "item-1" }], true]) {
      expect(err(validateToolInput("point_to", bad, city))).toMatch(/must be an object/i);
    }
  });

  it("rejects a wrongly typed or empty item_id", () => {
    expect(err(validateToolInput("point_to", { item_id: 1 }, city))).toMatch(/item_id/i);
    expect(err(validateToolInput("point_to", { item_id: "" }, city))).toMatch(/item_id/i);
    expect(err(validateToolInput("add_note", { item_id: 1, text: "x" }, city))).toMatch(/item_id/i);
    expect(err(validateToolInput("add_note", { item_id: "", text: "x" }, city))).toMatch(
      /item_id/i,
    );
  });

  it("never throws, whatever the model sends", () => {
    const junk: unknown[] = [
      undefined,
      null,
      NaN,
      () => {},
      Symbol("x"),
      { item_id: { nested: true } },
      { item_id: "item-1", statute_id: Symbol("x") },
      { item_id: "item-1", text: 123, statute_id: 456 },
      new Map(),
    ];
    for (const name of ["point_to", "mark_item", "draft_field", "add_note", "nope"]) {
      for (const input of junk) {
        expect(() => validateToolInput(name, input, city)).not.toThrow();
        expect(validateToolInput(name, input, city).ok).toBe(false);
      }
    }
  });

  it("does not throw on a city with an empty checklist", () => {
    const empty = { ...city, checklist: [] } as CityConfig;
    expect(err(validateToolInput("point_to", { item_id: "item-1" }, empty))).toMatch(
      /unknown item_id/i,
    );
    // ...but a general add_note needs no checklist at all.
    expect(ok(validateToolInput("add_note", { text: "general" }, empty)).event.tool).toBe(
      "add_note",
    );
  });
});
