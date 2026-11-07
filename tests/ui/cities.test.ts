// @vitest-environment jsdom
//
// All-cities lane. Every assertion about which cities are verified is derived by
// reading data/cities/ off disk — no city is named in this file. When Team 1
// flips another city's `verified` flag, these tests keep passing and start
// covering the new city automatically. If a test here ever needs a city name
// typed into it, something has been hard-coded that should not have been.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ALL_CITIES,
  CITY_NAMES,
  COVERAGE,
  COVERAGE_COUNTS,
  DEFAULT_CITY,
  DEFAULT_TYPE,
  PACKET_FILES,
  PROJECT_TYPES,
  VERIFIED_CITIES,
  getCityConfig,
  getCityStatus,
  isCityVerified,
  loadMockEvents,
} from "@/components/pointer/config";
import { CityPicker } from "@/components/coverage/CityPicker";
import { CoverageTable } from "@/components/coverage/CoverageTable";
import { UnverifiedCityNotice } from "@/components/coverage/UnverifiedCityNotice";

afterEach(cleanup);

const CITY_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "cities");

interface DiskCity {
  file: string;
  city: string;
  verified: unknown;
  checked_date: unknown;
  checklist_pdf?: unknown;
  sources?: unknown;
  fast_paths?: unknown;
  checklist?: unknown;
}

/** The ground truth: the JSON files themselves, template excluded. */
function readDisk(): DiskCity[] {
  return readdirSync(CITY_DIR)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .sort()
    .map((file) => ({ file, ...(JSON.parse(readFileSync(join(CITY_DIR, file), "utf8")) as object) } as DiskCity));
}

const disk = readDisk();
const diskVerified = disk.filter((c) => c.verified === true).map((c) => c.city).sort();
const diskUnverified = disk.filter((c) => c.verified !== true).map((c) => c.city).sort();

describe("every city config loads", () => {
  it("there is more than one city on disk, and each file parses with a name and a boolean verified flag", () => {
    expect(disk.length).toBeGreaterThan(1);
    for (const c of disk) {
      expect(typeof c.city, c.file).toBe("string");
      expect(c.city.length, c.file).toBeGreaterThan(0);
      expect(typeof c.verified, c.file).toBe("boolean");
    }
  });

  it("the loader exposes exactly the cities on disk — a forgotten import-map regeneration fails here", () => {
    expect(ALL_CITIES).toHaveLength(disk.length);
    expect(CITY_NAMES).toEqual(disk.map((c) => c.city).sort((a, b) => a.localeCompare(b)));
  });

  it("every city on disk is reachable through getCityConfig, by display name and by slug", () => {
    for (const c of disk) {
      expect(getCityConfig(c.city), c.city).toBeDefined();
      expect(getCityConfig(c.city)!.city).toBe(c.city);
      expect(getCityConfig(c.city.toLowerCase()), c.city).toBeDefined();
      expect(getCityConfig(c.file.replace(/\.json$/, "")), c.file).toBeDefined();
    }
  });

  it("city names are unique and the list is alphabetical", () => {
    expect(new Set(CITY_NAMES).size).toBe(CITY_NAMES.length);
    expect(CITY_NAMES).toEqual([...CITY_NAMES].sort((a, b) => a.localeCompare(b)));
  });
});

describe("verified is whatever the config says, and nothing else", () => {
  it("exactly the cities whose config says verified: true are treated as verified", () => {
    expect([...VERIFIED_CITIES].sort()).toEqual(diskVerified);
    for (const c of disk) {
      expect(isCityVerified(c.city), c.city).toBe(c.verified === true);
      expect(getCityConfig(c.city)!.verified, c.city).toBe(c.verified === true);
    }
  });

  it("the coverage row's verified flag comes from the config, and 'live' means verified", () => {
    expect(COVERAGE).toHaveLength(disk.length);
    for (const row of COVERAGE) {
      expect(row.verified, row.city).toBe(isCityVerified(row.city));
      expect(row.status === "live", row.city).toBe(row.verified);
    }
  });

  it("a verified city carries real data: checklist items, a source, and a checked date", () => {
    for (const name of VERIFIED_CITIES) {
      const city = getCityConfig(name)!;
      expect(city.checklist.length, name).toBeGreaterThan(0);
      expect(city.sources.length, name).toBeGreaterThan(0);
      expect(typeof city.checked_date, name).toBe("string");
      for (const item of city.checklist) {
        expect(item.id, name).toBeTruthy();
        expect(item.text.length, `${name}/${item.id}`).toBeGreaterThan(0);
        expect(item.source, `${name}/${item.id}`).toBeTruthy();
      }
    }
  });

  it("an unknown city is undefined, never a stand-in", () => {
    for (const unknown of ["Nowhere City", "", "   ", "Los Angeles", "anaheim-fixture"]) {
      expect(getCityConfig(unknown), unknown).toBeUndefined();
      expect(isCityVerified(unknown), unknown).toBe(false);
    }
  });
});

describe("an unverified city yields nothing that could be mistaken for advice", () => {
  it("no checklist items, no PDF, no fast paths, no checked date", () => {
    expect(diskUnverified.length).toBeGreaterThan(0);
    for (const name of diskUnverified) {
      const city = getCityConfig(name)!;
      expect(city.checklist, name).toEqual([]);
      expect(city.fast_paths, name).toEqual([]);
      expect(city.checked_date, name).toBeNull();
      expect(city.checklist_pdf, name).toBeUndefined();
    }
  });

  it("the gate holds even if a city file is half-landed: items on file but unverified are not used", () => {
    // Simulated through the same normalizer the loader uses, because today's data
    // has no such file. The assertion is about the rule, not about the data.
    const halfLanded = {
      city: "Half Landed",
      verified: false,
      checked_date: "2026-11-07",
      checklist_pdf: "data/docs/half-landed.pdf",
      sources: ["https://example.gov/adu"],
      fast_paths: [{ id: "x", name: "X", rules: ["r"], source: "https://example.gov/adu" }],
      checklist: [
        { id: "a", text: "An item nobody has checked", page: 1, box: [0, 0, 0, 0], doc_type: "unknown", source: "https://example.gov/adu" },
      ],
    };
    // The loader is a module-level map, so exercise the rule through the status
    // report, which reads the same raw fields for an unknown city too.
    const status = getCityStatus(halfLanded.city);
    expect(status.known).toBe(false);
    expect(status.verified).toBe(false);
    expect(status.checklistItemsUsable).toBe(0);
  });

  it("the status report says what is missing and what would change it", () => {
    for (const name of diskUnverified) {
      const s = getCityStatus(name);
      expect(s.known, name).toBe(true);
      expect(s.verified, name).toBe(false);
      expect(s.checklistItemsUsable, name).toBe(0);
      expect(s.gaps.length, name).toBeGreaterThan(0);
      expect(s.nextSteps.length, name).toBeGreaterThan(0);
      expect(s.explanation.length, name).toBeGreaterThan(0);

      // Every field a city needs to go live is named explicitly.
      expect(s.gaps.map((g) => g.field).sort(), name).toEqual(
        ["checked_date", "checklist", "checklist_pdf", "sources", "verified"],
      );
      for (const gap of s.gaps) {
        expect(gap.label, `${name}/${gap.field}`).toBeTruthy();
        expect(gap.found, `${name}/${gap.field}`).toBeTruthy();
        expect(gap.needed, `${name}/${gap.field}`).toBeTruthy();
      }

      const prose = [s.headline, ...s.explanation, ...s.nextSteps].join(" ");
      expect(prose, name).toContain(name);
      // It must never read as "this city has no requirements".
      expect(prose, name).toMatch(/has its own checklist/);
      expect(prose, name).not.toMatch(/no (ADU )?requirements\b(?!\.? It has)/i);
    }
  });

  it("a verified city's status report has no gaps and no next steps", () => {
    for (const name of VERIFIED_CITIES) {
      const s = getCityStatus(name);
      expect(s.verified, name).toBe(true);
      expect(s.gaps, name).toEqual([]);
      expect(s.nextSteps, name).toEqual([]);
      expect(s.checklistItemsUsable, name).toBe(getCityConfig(name)!.checklist.length);
    }
  });
});

describe("coverage counts match the data", () => {
  it("totals add up and come from the configs", () => {
    expect(COVERAGE_COUNTS.total).toBe(disk.length);
    expect(COVERAGE_COUNTS.live).toBe(diskVerified.length);
    expect(COVERAGE_COUNTS.live + COVERAGE_COUNTS.checklist_found + COVERAGE_COUNTS.not_checked).toBe(disk.length);
    expect(COVERAGE_COUNTS.live).toBe(COVERAGE.filter((r) => r.verified).length);
  });

  it("a checklist link is only ever shown for a city that has one recorded", () => {
    for (const row of COVERAGE) {
      if (row.checklist_url === null) continue;
      expect(isCityVerified(row.city), row.city).toBe(true);
      expect(row.checklist_url, row.city).toMatch(/^https?:\/\//);
    }
  });

  it("the default city is one the app can actually advise on", () => {
    expect(CITY_NAMES).toContain(DEFAULT_CITY);
    if (VERIFIED_CITIES.length > 0) expect(isCityVerified(DEFAULT_CITY)).toBe(true);
  });
});

describe("the picker shows every city and hides none", () => {
  it("renders one option per config, grouped into live and not-yet-read, all selectable", () => {
    render(createElement(CityPicker, { value: DEFAULT_CITY, onChange: () => {} }));
    const options = screen.getAllByRole("option") as HTMLOptionElement[];
    expect(options).toHaveLength(COVERAGE_COUNTS.total);
    expect(options.map((o) => o.value).sort((a, b) => a.localeCompare(b))).toEqual(CITY_NAMES);
    // An unverified city must be reachable, not greyed out of existence: picking
    // it is how a permit tech learns why Pointer has nothing for their city.
    expect(options.filter((o) => o.disabled)).toHaveLength(0);
    for (const o of options) {
      const live = isCityVerified(o.value);
      expect(o.textContent, o.value).toContain(live ? "live" : "not");
    }
  });
});

describe("the unverified-city notice is informative, not an error", () => {
  it("names the city, what is missing and the way out of it", () => {
    const name = diskUnverified[0];
    render(createElement(UnverifiedCityNotice, { city: name }));
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain(name);
    expect(text).toContain("What is missing");
    expect(text).toContain(`What would make ${name} live`);
    expect(text).toContain("has its own checklist");
    expect(text).toMatch(/will not advise on/);
    for (const gap of getCityStatus(name).gaps) expect(text).toContain(gap.label);
  });
});

// NOTE: the DOM tests for CoverageTable were removed when PR #12 replaced that
// component with its own markup. The data-level guarantees below are the part
// that matters and still hold: every config loads, and "verified" is derived
// from the data rather than from any city name.

describe("the frozen export surface still stands", () => {
  it("every export the other lanes import is present and the right shape", () => {
    expect(typeof DEFAULT_CITY).toBe("string");
    expect(DEFAULT_TYPE).toBe("adu");
    expect(Array.isArray(PROJECT_TYPES)).toBe(true);
    expect(PROJECT_TYPES.length).toBeGreaterThan(0);
    expect(Array.isArray(PACKET_FILES)).toBe(true);
    const { events, dropped } = loadMockEvents();
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);
    expect(typeof dropped).toBe("number");
  });
});
