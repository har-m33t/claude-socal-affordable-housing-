// The one place the UI loads config and events. Until 12:45 everything comes from fixtures/.
// At integration, swap these imports for Team 1's data/cities/*.json and types/*.json, and
// swap the events for Team 3's stream. Components never import fixtures directly.
import cityAnaheim from "@/fixtures/mock-city-anaheim.json";
import citiesFixture from "@/fixtures/mock-cities.json";
import typesFixture from "@/fixtures/mock-types.json";
import packetFixture from "@/fixtures/mock-packet.json";
import eventsFixture from "@/fixtures/mock-events.json";
import {
  parseEvent,
  type AgentEvent,
  type CityConfig,
  type CoverageRow,
  type PacketFile,
  type ProjectType,
} from "./contract";

export const DATA_MODE = "mock" as const;

const CITY_CONFIGS: Record<string, CityConfig> = {
  Anaheim: cityAnaheim as unknown as CityConfig,
};

export const COVERAGE: CoverageRow[] = (citiesFixture.cities as CoverageRow[]).map((row) => ({
  ...row,
  // A city counts as verified only if its loaded config says so, whatever the coverage row says.
  verified: Boolean(CITY_CONFIGS[row.city]?.verified),
}));

export const PROJECT_TYPES: ProjectType[] = typesFixture.types as ProjectType[];

export const PACKET_FILES: PacketFile[] = packetFixture.files as PacketFile[];

export function getCityConfig(city: string): CityConfig | undefined {
  return CITY_CONFIGS[city];
}

export const DEFAULT_CITY = "Anaheim";
export const DEFAULT_TYPE = "adu";

/** Mock events, validated. Malformed rows are dropped and counted so the UI can show it. */
export function loadMockEvents(): { events: AgentEvent[]; dropped: number } {
  const raw = (eventsFixture as { events: unknown[] }).events;
  const events: AgentEvent[] = [];
  let dropped = 0;
  for (const r of raw) {
    const e = parseEvent(r);
    if (e) events.push(e);
    else dropped++;
  }
  return { events, dropped };
}
