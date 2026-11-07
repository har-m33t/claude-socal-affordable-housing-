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

function ok(result: ReturnType<typeof validateToolInput>) {
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);
  return result.event;
}

function err(result: ReturnType<typeof validateToolInput>) {
  if (result.ok) throw new Error(`expected failure, got event: ${JSON.stringify(result.event)}`);
  return result.error;
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
      // Every required field is actually declared in properties.
      const properties = tool.input_schema["properties"] as Record<string, unknown>;
      for (const field of tool.input_schema.required ?? []) {
        expect(Object.keys(properties)).toContain(field);
      }
    },
  );

  it.each(TOOL_DEFINITIONS.map((t) => [t.name, t] as const))(
    "%s declares the correct required array",
    (name, tool) => {
      const expected: Record<string, string[]> = {
        point_to: ["item_id"],
        highlight: ["item_id"],
        mark_item: ["item_id", "status"],
        draft_field: ["item_id", "text"],
        add_note: ["item_id", "text"],
      };
      expect(tool.input_schema.required).toEqual(expected[name]);
    },
  );

  it.each(TOOL_DEFINITIONS.map((t) => [t.name, t] as const))(
    "%s accepts an optional citation",
    (_name, tool) => {
      const properties = tool.input_schema["properties"] as Record<string, unknown>;
      expect(properties).toHaveProperty("citation");
      expect(tool.input_schema.required).not.toContain("citation");
    },
  );

  it.each(TOOL_DEFINITIONS.map((t) => [t.name, t] as const))(
    "%s tells the model about item_id and about never inventing law",
    (_name, tool) => {
      const description = tool.description ?? "";
      expect(description.length).toBeGreaterThan(80);
      expect(description).toContain("item_id");
      expect(description).toMatch(/checklist of the city configuration loaded/i);
      expect(description).toMatch(/never invent/i);
      expect(description).toMatch(/statute/i);
      expect(description).toMatch(/section/i);
      expect(description).toMatch(/fee/i);
      expect(description).toMatch(/date/i);
      expect(description).toMatch(/unknown/i);
    },
  );

  it("constrains mark_item status to the three allowed values", () => {
    const markItem = TOOL_DEFINITIONS.find((t) => t.name === "mark_item");
    const properties = markItem?.input_schema["properties"] as Record<
      string,
      { enum?: string[] }
    >;
    expect(properties.status?.enum).toEqual(["complete", "missing", "unknown"]);
  });
});

describe("validateToolInput - happy path", () => {
  it("accepts point_to", () => {
    const event = ok(validateToolInput("point_to", { item_id: "item-1" }, city));
    expect(event.tool).toBe("point_to");
    expect(event.item_id).toBe("item-1");
    expect(event.status).toBeUndefined();
    expect(event.text).toBeUndefined();
    expect(new Date(event.ts).toISOString()).toBe(event.ts);
  });

  it("accepts highlight", () => {
    const event = ok(validateToolInput("highlight", { item_id: "item-2" }, city));
    expect(event.tool).toBe("highlight");
    expect(event.item_id).toBe("item-2");
  });

  it("accepts mark_item with each valid status", () => {
    for (const status of ["complete", "missing", "unknown"] as const) {
      const event = ok(validateToolInput("mark_item", { item_id: "item-3", status }, city));
      expect(event.tool).toBe("mark_item");
      expect(event.status).toBe(status);
    }
  });

  it("accepts draft_field", () => {
    const event = ok(
      validateToolInput("draft_field", { item_id: "item-4", text: "Owner: [YOUR NAME]" }, city),
    );
    expect(event.tool).toBe("draft_field");
    expect(event.text).toBe("Owner: [YOUR NAME]");
  });

  it("accepts add_note", () => {
    const event = ok(
      validateToolInput("add_note", { item_id: "item-1", text: "Unknown - ask the counter." }, city),
    );
    expect(event.tool).toBe("add_note");
    expect(event.text).toBe("Unknown - ask the counter.");
  });

  it("accepts text of exactly 4000 characters", () => {
    const text = "x".repeat(4000);
    const event = ok(validateToolInput("draft_field", { item_id: "item-1", text }, city));
    expect(event.text).toHaveLength(4000);
  });

  it("carries a well-formed citation through", () => {
    const citation = {
      source_url: "https://example.invalid/fixture-checklist",
      checked_date: "2026-11-07",
      detail: "Section 2(b)",
    };
    const event = ok(validateToolInput("point_to", { item_id: "item-1", citation }, city));
    expect(event.citation).toEqual(citation);
  });

  it("produces an event that serializes without undefined keys", () => {
    const event = ok(validateToolInput("point_to", { item_id: "item-1" }, city));
    expect(Object.keys(JSON.parse(JSON.stringify(event))).sort()).toEqual([
      "item_id",
      "tool",
      "ts",
    ]);
  });

  it("accepts a real city config whose box and page are null", () => {
    const firstItem = anaheim.checklist[0]!;
    expect(firstItem.box).toBeNull();
    expect(firstItem.page).toBeNull();
    const event = ok(validateToolInput("add_note", { item_id: firstItem.id, text: "note" }, anaheim));
    expect(event.item_id).toBe(firstItem.id);
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
    expect(ok(validateToolInput("point_to", { item_id: "item-1" }, unverifiedCity)).item_id).toBe(
      "item-1",
    );
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
      const input: Record<string, unknown> = { item_id: "item-1", status: "complete" };
      if (name !== "highlight") input.text = "hello";
      expect(err(validateToolInput(name, input, city))).toMatch(/"status" is only allowed/);
    }
  });

  it("rejects text supplied to point_to, highlight and mark_item", () => {
    expect(err(validateToolInput("point_to", { item_id: "item-1", text: "hi" }, city))).toMatch(
      /"text" is only allowed/,
    );
    expect(err(validateToolInput("highlight", { item_id: "item-1", text: "hi" }, city))).toMatch(
      /"text" is only allowed/,
    );
    expect(
      err(
        validateToolInput("mark_item", { item_id: "item-1", status: "complete", text: "hi" }, city),
      ),
    ).toMatch(/"text" is only allowed/);
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
    expect(err(validateToolInput("point_to", { item_id: null }, city))).toMatch(/item_id/i);
  });

  it("rejects a malformed citation", () => {
    expect(
      err(
        validateToolInput(
          "point_to",
          { item_id: "item-1", citation: { source_url: "not a url", checked_date: "2026-11-07" } },
          city,
        ),
      ),
    ).toMatch(/source_url/);
    expect(
      err(
        validateToolInput(
          "point_to",
          {
            item_id: "item-1",
            citation: { source_url: "https://example.invalid/x", checked_date: "last Tuesday" },
          },
          city,
        ),
      ),
    ).toMatch(/checked_date/);
    expect(
      err(
        validateToolInput(
          "point_to",
          { item_id: "item-1", citation: { source_url: "https://example.invalid/x" } },
          city,
        ),
      ),
    ).toMatch(/checked_date/);
  });

  it("never throws, whatever the model sends", () => {
    const junk: unknown[] = [
      undefined,
      null,
      NaN,
      () => {},
      Symbol("x"),
      { item_id: { nested: true } },
      { item_id: "item-1", citation: "https://example.invalid/x" },
      new Map(),
    ];
    for (const name of ["point_to", "mark_item", "draft_field", "nope"]) {
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
  });
});
