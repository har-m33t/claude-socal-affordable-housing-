// The one place the UI loads city config, project types and events.
//
// Cities are now read entirely from `data/cities/*.json` — all 34 Orange County
// jurisdictions, not just the verified one. Nothing here names a city: which
// cities exist, and which of them are verified, is whatever the data says. When
// Team 1 flips another city's `verified` flag, this file, the picker and the
// coverage page pick it up with no code change.
//
// The hard rule this file enforces: an unverified city can never hand the UI a
// checklist item, a PDF or a date. If a person has not read the city's checklist
// and recorded the date, the answer is "unknown", and `getCityStatus()` says
// exactly what is missing instead of going quiet.
import typeAdu from "@/data/types/adu.json";
import typesFixture from "@/fixtures/mock-types.json";
import packetManifest from "@/data/packet/manifest.json";
import planAnaheimAdu from "@/data/plans/anaheim-adu.json";
import { checkPlan, type Plan } from "./plan";
import {
  isSafeUrl,
  normalizeSource,
  type ChecklistItem,
  type CityConfig,
  type CoverageRow,
  type CoverageStatus,
  type PacketFile,
  type ProjectType,
  type Source,
} from "./contract";

// ---------------------------------------------------------------------------
// City registry
//
// GENERATED BLOCK — one static `import` per file in data/cities/ (minus
// `_template.json`). A static import map is used rather than a glob because it
// is the only loader both toolchains handle identically: `import.meta.glob` is a
// Vite feature (fine in vitest, not guaranteed under Next/Turbopack), and
// `node:fs` is unavailable in the client bundle that `Editor.tsx` pulls this
// module into. Static JSON imports work in the browser bundle, on the server and
// in vitest, with no runtime file access at all.
//
// Regenerate after adding or removing a city file:
//
//   node -e 'const fs=require("fs");const f=fs.readdirSync("data/cities").filter(x=>x.endsWith(".json")&&!x.startsWith("_")).sort();const id=s=>"city_"+s.replace(/\.json$/,"").replace(/[^a-z0-9]+/gi,"_");console.log(f.map(x=>`import ${id(x)} from "@/data/cities/${x}";`).join("\n")+"\n\n"+f.map(x=>`  ${id(x)},`).join("\n"))'
//
// `tests/ui/cities.test.ts` reads data/cities/ off disk and fails if the two
// ever disagree, so a forgotten regeneration is caught by the suite.
import city_aliso_viejo from "@/data/cities/aliso-viejo.json";
import city_anaheim from "@/data/cities/anaheim.json";
import city_brea from "@/data/cities/brea.json";
import city_buena_park from "@/data/cities/buena-park.json";
import city_costa_mesa from "@/data/cities/costa-mesa.json";
import city_cypress from "@/data/cities/cypress.json";
import city_dana_point from "@/data/cities/dana-point.json";
import city_fountain_valley from "@/data/cities/fountain-valley.json";
import city_fullerton from "@/data/cities/fullerton.json";
import city_garden_grove from "@/data/cities/garden-grove.json";
import city_huntington_beach from "@/data/cities/huntington-beach.json";
import city_irvine from "@/data/cities/irvine.json";
import city_la_habra from "@/data/cities/la-habra.json";
import city_la_palma from "@/data/cities/la-palma.json";
import city_laguna_beach from "@/data/cities/laguna-beach.json";
import city_laguna_hills from "@/data/cities/laguna-hills.json";
import city_laguna_niguel from "@/data/cities/laguna-niguel.json";
import city_laguna_woods from "@/data/cities/laguna-woods.json";
import city_lake_forest from "@/data/cities/lake-forest.json";
import city_los_alamitos from "@/data/cities/los-alamitos.json";
import city_mission_viejo from "@/data/cities/mission-viejo.json";
import city_newport_beach from "@/data/cities/newport-beach.json";
import city_orange from "@/data/cities/orange.json";
import city_placentia from "@/data/cities/placentia.json";
import city_rancho_santa_margarita from "@/data/cities/rancho-santa-margarita.json";
import city_san_clemente from "@/data/cities/san-clemente.json";
import city_san_juan_capistrano from "@/data/cities/san-juan-capistrano.json";
import city_santa_ana from "@/data/cities/santa-ana.json";
import city_seal_beach from "@/data/cities/seal-beach.json";
import city_stanton from "@/data/cities/stanton.json";
import city_tustin from "@/data/cities/tustin.json";
import city_villa_park from "@/data/cities/villa-park.json";
import city_westminster from "@/data/cities/westminster.json";
import city_yorba_linda from "@/data/cities/yorba-linda.json";

/** The raw JSON as Team 1 writes it. Extra keys (`notes`, `applies_to`) ride along untouched. */
type RawCity = {
  city?: unknown;
  verified?: unknown;
  checked_date?: unknown;
  checklist_pdf?: unknown;
  sources?: unknown;
  fast_paths?: unknown;
  checklist?: unknown;
  notes?: unknown;
};

const RAW_CITIES: RawCity[] = [
  city_aliso_viejo,
  city_anaheim,
  city_brea,
  city_buena_park,
  city_costa_mesa,
  city_cypress,
  city_dana_point,
  city_fountain_valley,
  city_fullerton,
  city_garden_grove,
  city_huntington_beach,
  city_irvine,
  city_la_habra,
  city_la_palma,
  city_laguna_beach,
  city_laguna_hills,
  city_laguna_niguel,
  city_laguna_woods,
  city_lake_forest,
  city_los_alamitos,
  city_mission_viejo,
  city_newport_beach,
  city_orange,
  city_placentia,
  city_rancho_santa_margarita,
  city_san_clemente,
  city_san_juan_capistrano,
  city_santa_ana,
  city_seal_beach,
  city_stanton,
  city_tustin,
  city_villa_park,
  city_westminster,
  city_yorba_linda,
];

/**
 * Team 1 records checklist_pdf as a repo path (data/docs/...). Next only serves
 * public/, so the same file is copied to public/data/docs/ and the repo path
 * maps onto the served URL by prefixing a slash.
 */
function servedPdf(repoPath: unknown): string | undefined {
  if (typeof repoPath !== "string" || repoPath.length === 0) return undefined;
  return repoPath.startsWith("/") ? repoPath : `/${repoPath}`;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** The display name, or "" for a file with no usable `city`. */
function rawName(raw: RawCity): string {
  return typeof raw.city === "string" ? raw.city.trim() : "";
}

/** `verified` must be the boolean `true`. A string "true" is not a verification. */
function rawVerified(raw: RawCity): boolean {
  return raw.verified === true;
}

function rawCheckedDate(raw: RawCity): string | null {
  return typeof raw.checked_date === "string" && raw.checked_date.length > 0 ? raw.checked_date : null;
}

function rawChecklist(raw: RawCity): ChecklistItem[] {
  return asArray(raw.checklist) as ChecklistItem[];
}

function rawSources(raw: RawCity): Source[] {
  return asArray(raw.sources)
    .filter((s): s is Source | string => typeof s === "string" || (!!s && typeof s === "object"))
    .map(normalizeSource)
    .filter((s) => typeof s.url === "string" && isSafeUrl(s.url));
}

/**
 * The gate. An unverified city keeps its name, its status and its gaps, and
 * loses everything a reader could mistake for guidance: no checklist items, no
 * PDF, no fast paths, no checked date. Those are not dropped because they are
 * absent — on a half-landed city they may be present — they are dropped because
 * nobody has signed off on them yet. `getCityStatus()` reports what was withheld.
 */
function normalizeCity(raw: RawCity): CityConfig {
  const verified = rawVerified(raw);
  return {
    city: rawName(raw),
    verified,
    checked_date: verified ? rawCheckedDate(raw) : null,
    checklist_pdf: verified ? servedPdf(raw.checklist_pdf) : undefined,
    sources: rawSources(raw),
    fast_paths: verified ? (asArray(raw.fast_paths) as CityConfig["fast_paths"]) : [],
    checklist: verified ? rawChecklist(raw) : [],
  };
}

function statusOf(raw: RawCity): CoverageStatus {
  if (rawVerified(raw)) return "live";
  // Somebody has found the paperwork but nobody has read it through yet.
  const found =
    typeof raw.checklist_pdf === "string" && raw.checklist_pdf.length > 0
      ? true
      : rawChecklist(raw).length > 0 || rawSources(raw).length > 0;
  return found ? "checklist_found" : "not_checked";
}

/**
 * Where the checklist itself lives. Every transcribed checklist item records the
 * URL of the document it was read from, so that URL is the checklist's address
 * as stated by the data. `sources` is NOT used as a fallback: those entries are
 * landing pages and catalogues, and picking one would be a guess.
 */
function checklistUrlOf(raw: RawCity): string | null {
  for (const item of rawChecklist(raw)) {
    const url = typeof item?.source === "string" ? item.source : item?.source?.url;
    if (typeof url === "string" && isSafeUrl(url)) return url;
  }
  return null;
}

/** "Santa Ana", "santa ana" and "santa-ana" all resolve to the same city. */
function lookupKey(city: string): string {
  return city.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

const BY_NAME = new Map<string, { raw: RawCity; config: CityConfig }>();
const ENTRIES: { raw: RawCity; config: CityConfig }[] = [];

for (const raw of RAW_CITIES) {
  const name = rawName(raw);
  // A file with no city name is unusable; it must not become a nameless row.
  if (!name) continue;
  const entry = { raw, config: normalizeCity(raw) };
  ENTRIES.push(entry);
  BY_NAME.set(name, entry);
  BY_NAME.set(lookupKey(name), entry);
}
ENTRIES.sort((a, b) => a.config.city.localeCompare(b.config.city));

/** Every city with a config, alphabetical. Verified and unverified alike — nothing is hidden. */
export const ALL_CITIES: CityConfig[] = ENTRIES.map((e) => e.config);

/** Display names, alphabetical. */
export const CITY_NAMES: string[] = ALL_CITIES.map((c) => c.city);

/** The cities a person has read and signed off on. Derived, never a hand-written list. */
export const VERIFIED_CITIES: string[] = ALL_CITIES.filter((c) => c.verified).map((c) => c.city);

/** One row per real config. The fixture coverage list is gone; this is the data. */
export const COVERAGE: CoverageRow[] = ENTRIES.map(({ raw, config }) => ({
  city: config.city,
  status: statusOf(raw),
  verified: config.verified,
  checked_date: config.checked_date,
  checklist_url: checklistUrlOf(raw),
}));

export interface CoverageCounts {
  total: number;
  live: number;
  checklist_found: number;
  not_checked: number;
}

/** Counts straight off COVERAGE, so the headline on the coverage page cannot drift. */
export const COVERAGE_COUNTS: CoverageCounts = {
  total: COVERAGE.length,
  live: COVERAGE.filter((r) => r.status === "live").length,
  checklist_found: COVERAGE.filter((r) => r.status === "checklist_found").length,
  not_checked: COVERAGE.filter((r) => r.status === "not_checked").length,
};

export function getCityConfig(city: string): CityConfig | undefined {
  if (typeof city !== "string" || city.trim() === "") return undefined;
  return (BY_NAME.get(city) ?? BY_NAME.get(lookupKey(city)))?.config;
}

/** True only for a city whose own config says `verified: true`. Unknown cities are never verified. */
export function isCityVerified(city: string): boolean {
  return getCityConfig(city)?.verified === true;
}

// ---------------------------------------------------------------------------
// What is missing, and what would change it

export type CityGapField = "verified" | "checked_date" | "checklist" | "checklist_pdf" | "sources";

export interface CityGap {
  field: CityGapField;
  /** Human label for the thing that is missing. */
  label: string;
  /** What the config holds today. */
  found: string;
  /** What has to be there before this city can go live. */
  needed: string;
}

export interface CityStatusReport {
  /** The city's own name, or the name as asked for when there is no config. */
  city: string;
  /** False when no config file exists for this name at all. */
  known: boolean;
  verified: boolean;
  status: CoverageStatus;
  checkedDate: string | null;
  /** Items transcribed into the file, whether or not they have been signed off. */
  checklistItemsOnFile: number;
  /** Items the UI is allowed to use. Always 0 until the city is verified. */
  checklistItemsUsable: number;
  hasChecklistPdf: boolean;
  sources: Source[];
  checklistUrl: string | null;
  /** Empty for a verified city. */
  gaps: CityGap[];
  /** The route to live, in order. Empty for a verified city. */
  nextSteps: string[];
  headline: string;
  /** Why there is no advice, and what the silence does and does not mean. */
  explanation: string[];
}

/**
 * The single source of the unverified-city message. UI renders this; it never
 * writes its own copy. A city with no config and a city with an empty config get
 * the same treatment, because the honest answer in both cases is the same.
 */
export function getCityStatus(city: string): CityStatusReport {
  const asked = typeof city === "string" ? city.trim() : "";
  const entry = BY_NAME.get(asked) ?? BY_NAME.get(lookupKey(asked));
  const name = entry?.config.city ?? (asked || "This city");

  if (entry?.config.verified) {
    const { config, raw } = entry;
    return {
      city: name,
      known: true,
      verified: true,
      status: "live",
      checkedDate: config.checked_date,
      checklistItemsOnFile: config.checklist.length,
      checklistItemsUsable: config.checklist.length,
      hasChecklistPdf: Boolean(config.checklist_pdf),
      sources: config.sources.map(normalizeSource),
      checklistUrl: checklistUrlOf(raw),
      gaps: [],
      nextSteps: [],
      headline: `${name} is live`,
      explanation: [
        `A person read ${name}'s submittal checklist on ${config.checked_date ?? "an unrecorded date"} and recorded ${config.checklist.length} item${config.checklist.length === 1 ? "" : "s"} from it.`,
      ],
    };
  }

  const raw = entry?.raw;
  const itemsOnFile = raw ? rawChecklist(raw).length : 0;
  const sources = raw ? rawSources(raw) : [];
  const hasPdf = Boolean(raw && typeof raw.checklist_pdf === "string" && raw.checklist_pdf.length > 0);
  const rawDate = raw ? rawCheckedDate(raw) : null;

  const gaps: CityGap[] = [
    {
      field: "verified",
      label: "A person's sign-off (verified)",
      found: entry ? "verified: false" : "no config file for this city",
      needed: "verified: true, set by the person who read the checklist — not by the agent",
    },
    {
      field: "checked_date",
      label: "The date the source was read (checked_date)",
      found: rawDate ? `checked_date: ${rawDate}, recorded but not signed off` : "checked_date: null",
      needed: "the date the checklist PDF was actually opened and read",
    },
    {
      field: "checklist",
      label: "Checklist items",
      found:
        itemsOnFile === 0
          ? "0 items on file"
          : `${itemsOnFile} item${itemsOnFile === 1 ? "" : "s"} transcribed but not signed off, so none are used`,
      needed: "every printed requirement, transcribed word for word with its page and box",
    },
    {
      field: "checklist_pdf",
      label: "The checklist PDF",
      found: hasPdf ? "a path is recorded but not signed off" : "no checklist_pdf recorded",
      needed: "the city's own submittal checklist, saved so it can be shown next to the draft",
    },
    {
      field: "sources",
      label: "Sources",
      found: sources.length === 0 ? "0 sources recorded" : `${sources.length} source${sources.length === 1 ? "" : "s"} recorded`,
      needed: "at least one URL on the city's own site, so every item can be traced back",
    },
  ];

  return {
    city: name,
    known: Boolean(entry),
    verified: false,
    status: raw ? statusOf(raw) : "not_checked",
    checkedDate: null,
    checklistItemsOnFile: itemsOnFile,
    checklistItemsUsable: 0,
    hasChecklistPdf: hasPdf,
    sources,
    checklistUrl: null,
    gaps,
    nextSteps: [
      `Find ${name}'s own ADU submittal checklist on the city's website and record its URL in the city's config under "sources".`,
      "Save that PDF into the repo and record it as \"checklist_pdf\", so a reviewer can see the page the text came from.",
      "Transcribe each printed requirement into \"checklist\" with its page and box, copied from the page. Anything the document does not state stays unknown — it is never filled in from another city.",
      "Record \"checked_date\" as the day you read it, and set \"verified\": true.",
    ],
    headline: entry
      ? `${name}'s checklist has not been read yet`
      : `Pointer has no config for ${name}`,
    explanation: [
      `Pointer will not advise on ${name}. Nobody has read ${name}'s own submittal checklist and recorded it, so there is nothing here that can be traced back to the city.`,
      `This does not mean ${name} has no ADU requirements. It has its own checklist, its own fees and its own review steps — Pointer simply has not read them, and it will not guess at them from a neighbouring city. Work from the city's own permit counter until this city is live.`,
      `${name} goes live the moment a person reads its checklist and records it. Nothing about this screen changes until then.`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Project types, packet, events

export const PROJECT_TYPES: ProjectType[] = (typesFixture.types as ProjectType[]).map((t) =>
  // Team 1's real ADU pack decides whether the ADU type is verified; the rest
  // stay as the fixture lists them, which is to say not verified.
  t.type === "adu" ? { ...t, verified: Boolean((typeAdu as { verified?: boolean }).verified) } : t,
);

/** The made-up applicant's files (Team 1's packet manifest), the same files the plan's file slots name. */
export const PACKET_FILES: PacketFile[] = packetManifest.files as PacketFile[];

/**
 * The city the editor opens on: the first verified city there is. Not a name —
 * if the only verified city changes, or a second one lands, this follows the
 * data. Falls back to the first city alphabetically when nothing is verified
 * yet, which the editor then refuses to advise on, as it should.
 */
export const DEFAULT_CITY: string = VERIFIED_CITIES[0] ?? CITY_NAMES[0] ?? "";
export const DEFAULT_TYPE = "adu";

/** The multi-step plan for the default city and type. Invalid plans throw at load. */
export const PLAN: Plan = (() => {
  const plan = planAnaheimAdu as unknown as Plan;
  const problems = checkPlan(plan);
  if (problems.length) throw new Error(`data/plans/anaheim-adu.json is invalid: ${problems.join("; ")}`);
  return plan;
})();

/**
 * The plan for a city and project type, or undefined when none has been written.
 * Only Anaheim ADU has one today; a verified city without a plan gets no run.
 */
export function planFor(city: string, projectType: string): Plan | undefined {
  const norm = (v: string) => v.trim().toLowerCase();
  return norm(PLAN.city) === norm(city) && norm(PLAN.project_type) === norm(projectType) ? PLAN : undefined;
}
