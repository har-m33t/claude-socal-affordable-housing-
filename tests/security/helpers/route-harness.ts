/**
 * Drives an agent route (Team 3's real one, or a reference fixture) under test.
 *
 * EVERY assumption about Team 3's route lives in this file, so if Team 3 differs it
 * is a one-place change:
 *
 *  1. Location:   app/api/agent/route.ts, exporting `POST(req: Request): Promise<Response>`.
 *  2. Request:    JSON body `{ city, type, documents: [{ name, declared_type, text }] }`
 *                 (document text already redacted in the browser).  -> buildAgentRequest()
 *  3. Response:   `text/event-stream`; each agent action is one `data: <event JSON>\n\n`
 *                 frame. Frames carrying an SSE `event:` name other than "message"
 *                 (e.g. `event: done`) are treated as control frames, not agent
 *                 actions.                                            -> parseAgentResponse()
 *  4. City data:  data/cities/<city>.json; tests use "anaheim" (verified) and "brea"
 *                 (unverified stub).                                  -> realRouteTarget()
 *  5. Client:     the route talks to Claude only through @anthropic-ai/sdk using the
 *                 global fetch and ANTHROPIC_API_KEY from the environment (no custom
 *                 `fetch`, no ANTHROPIC_BASE_URL).                      -> loadRouteModule()
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { vi } from "vitest";
import type { AgentEvent, CityConfig } from "./contracts";
import type { FakeAnthropic } from "./fake-anthropic";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const REAL_ROUTE_PATH = "app/api/agent/route.ts";
export const REAL_CITY_DIR = "data/cities";
export const REAL_VERIFIED_CITY = "anaheim";
export const REAL_UNVERIFIED_CITY = "brea";

/** Max requests to Anthropic in one run. Override with POINTER_TEST_STEP_CAP. */
export const STEP_CAP = Number(process.env.POINTER_TEST_STEP_CAP ?? 25);
/** Ceiling for max_tokens per request. Override with POINTER_TEST_MAX_TOKENS_CEILING. */
export const MAX_TOKENS_CEILING = Number(process.env.POINTER_TEST_MAX_TOKENS_CEILING ?? 32000);
const RUN_TIMEOUT_MS = 20_000;

export interface AgentDocument {
  name: string;
  declared_type: string;
  text: string;
}

/**
 * The real route's body, as confirmed by the Team 3 lead on issue #3:
 * `projectType`, not `type` (which collides with the SSE frame
 * discriminator), and `question` is required - it is the homeowner's actual
 * request. The route uses z.strictObject, so an unknown key is a 400.
 */
export interface AgentRequestBody {
  city: string;
  projectType: string;
  question: string;
  documents?: AgentDocument[];
}

export interface RouteModule {
  POST(req: Request): Promise<Response>;
}

export interface RouteTarget {
  label: string;
  modulePath: string;
  cityDir: string;
  verifiedCity: string;
  unverifiedCity: string;
  projectType: string;
}

export function buildAgentRequest(body: AgentRequestBody): Request {
  return new Request("http://localhost:3000/api/agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export interface ParsedStream {
  status: number;
  contentType: string;
  events: AgentEvent[];
  controlFrames: Array<{ event: string; data: string }>;
  parseErrors: string[];
}

export async function parseAgentResponse(res: Response): Promise<ParsedStream> {
  const contentType = res.headers.get("content-type") ?? "";
  const raw = await res.text();
  const parsed: ParsedStream = { status: res.status, contentType, events: [], controlFrames: [], parseErrors: [] };
  if (!contentType.includes("text/event-stream")) return parsed;

  for (const frame of raw.split(/\r?\n\r?\n/)) {
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (dataLines.length === 0) continue;
    const data = dataLines.join("\n");
    if (eventName !== "message") {
      parsed.controlFrames.push({ event: eventName, data });
      continue;
    }
    try {
      const value: unknown = JSON.parse(data);
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        parsed.parseErrors.push(`data frame is not a JSON object: ${data.slice(0, 120)}`);
      } else {
        // The route streams a StreamFrame per `data:` line, not a bare event:
        // an action is {type:"event", event:{...}}. Unwrap it. Non-action
        // frames carry an SSE `event:` name and are already split off above.
        const frame = value as { type?: unknown; event?: unknown };
        if (frame.type === "event" && typeof frame.event === "object" && frame.event !== null) {
          parsed.events.push(frame.event as AgentEvent);
        } else {
          parsed.events.push(value as AgentEvent);
        }
      }
    } catch {
      parsed.parseErrors.push(`data frame is not JSON: ${data.slice(0, 120)}`);
    }
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Targets

export function realRouteTarget(): RouteTarget {
  return {
    label: `real route (${REAL_ROUTE_PATH})`,
    modulePath: join(REPO_ROOT, REAL_ROUTE_PATH),
    cityDir: join(REPO_ROOT, REAL_CITY_DIR),
    verifiedCity: REAL_VERIFIED_CITY,
    unverifiedCity: REAL_UNVERIFIED_CITY,
    projectType: "adu",
  };
}

/** Paths the real-route tests need; returns the missing ones with their owner. */
export function missingForRealRoute(cities: string[] = [REAL_VERIFIED_CITY, REAL_UNVERIFIED_CITY]): string[] {
  const needed: Array<[string, string]> = [
    [REAL_ROUTE_PATH, "Team 3"],
    ...cities.map((city): [string, string] => [`${REAL_CITY_DIR}/${city}.json`, "Team 1"]),
  ];
  return needed.filter(([path]) => !existsSync(join(REPO_ROOT, path))).map(([path, team]) => `${team}: ${path}`);
}

export function skipReason(missing: string[]): string {
  return missing.length === 0 ? "" : `waiting for ${missing.join(", ")} missing`;
}

const FIXTURE_ROUTES = join(REPO_ROOT, "tests/security/fixtures/routes");

export function referenceTarget(kind: "safe" | "unsafe"): RouteTarget {
  return {
    label: `reference ${kind} route (test fixture)`,
    modulePath: join(FIXTURE_ROUTES, `${kind}-route.ts`),
    cityDir: join(FIXTURE_ROUTES, "cities"),
    verifiedCity: "anaheim-fixture",
    unverifiedCity: "brea-fixture",
    projectType: "adu",
  };
}

export function loadCity(target: RouteTarget, cityId: string): CityConfig {
  return JSON.parse(readFileSync(join(target.cityDir, `${cityId}.json`), "utf8")) as CityConfig;
}

// ---------------------------------------------------------------------------
// Interception

type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
let activeFetch: FetchHandler | null = null;
let dispatcherInstalled = false;
const realFetch = globalThis.fetch;

/** One permanent global fetch that forwards to whichever handler the current run set. */
function installFetchDispatcher(): void {
  if (dispatcherInstalled) return;
  dispatcherInstalled = true;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    if (!activeFetch) {
      return Promise.reject(new TypeError("fetch called outside a security-test run; blocked"));
    }
    return activeFetch(input, init);
  });
}

/**
 * Patches Node's raw socket entry points for the duration of a run, so a route that
 * bypasses fetch (node:http, node:https, node:net, node:tls) is still caught.
 */
function guardNodeNetwork(onAttempt: (url: string, via: string) => void): () => void {
  const require = createRequire(import.meta.url);
  const restores: Array<() => void> = [];
  const patch = (moduleName: string, fns: string[]) => {
    const mod = require(moduleName) as Record<string, unknown>;
    for (const fn of fns) {
      const original = mod[fn];
      mod[fn] = (...args: unknown[]) => {
        const first = args[0];
        const target =
          typeof first === "string" || first instanceof URL ? String(first) : JSON.stringify(first ?? {}).slice(0, 200);
        onAttempt(target, `${moduleName}.${fn}`);
        throw new Error(`${moduleName}.${fn} blocked by security test`);
      };
      restores.push(() => {
        mod[fn] = original;
      });
    }
  };
  patch("node:http", ["request", "get"]);
  patch("node:https", ["request", "get"]);
  patch("node:net", ["connect", "createConnection"]);
  patch("node:tls", ["connect"]);
  syncBuiltinESMExports();
  return () => {
    for (const restore of restores) restore();
    syncBuiltinESMExports();
  };
}

export type RouteMode =
  | { kind: "fake"; fake: FakeAnthropic }
  | { kind: "live"; onAnthropicRequest: (body: unknown) => void; onBlocked: (url: string) => void };

async function loadRouteModule(modulePath: string): Promise<RouteModule> {
  installFetchDispatcher();
  // Fresh module per run: a route that builds its client at import time gets the
  // dispatcher and the env of THIS run, and no state leaks between runs.
  vi.resetModules();
  const mod = (await import(/* @vite-ignore */ pathToFileURL(modulePath).href)) as Partial<RouteModule>;
  if (typeof mod.POST !== "function") {
    throw new Error(`${modulePath} does not export POST(req: Request): Promise<Response>`);
  }
  return mod as RouteModule;
}

function liveFetch(mode: Extract<RouteMode, { kind: "live" }>): FetchHandler {
  return async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== "https://api.anthropic.com") {
      mode.onBlocked(request.url);
      throw new TypeError(`fetch failed: outbound request to ${url.origin} blocked by security test`);
    }
    if (url.pathname === "/v1/messages") {
      mode.onAnthropicRequest(JSON.parse(await request.clone().text()));
    }
    return realFetch(request);
  };
}

export interface RouteRun extends ParsedStream {
  /** Error thrown by POST or while reading the body, if any. */
  thrown: string | null;
  timedOut: boolean;
}

export async function runRoute(target: RouteTarget, body: AgentRequestBody, mode: RouteMode): Promise<RouteRun> {
  if (mode.kind === "fake") {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-fake-key-for-security-tests");
  }
  vi.stubEnv("ANTHROPIC_BASE_URL", undefined);
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", undefined);

  const onBlocked = (url: string, via: string) =>
    mode.kind === "fake" ? mode.fake.recordBlocked(url, "?", via) : mode.onBlocked(`${via} ${url}`);
  activeFetch = mode.kind === "fake" ? mode.fake.fetch : liveFetch(mode);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), mode.kind === "live" ? 120_000 : RUN_TIMEOUT_MS);
  });
  const empty: ParsedStream = { status: 0, contentType: "", events: [], controlFrames: [], parseErrors: [] };
  let restoreNetwork: (() => void) | null = null;
  try {
    const route = await loadRouteModule(target.modulePath);
    restoreNetwork = guardNodeNetwork(onBlocked);
    const outcome = await Promise.race([
      route.POST(buildAgentRequest(body)).then(parseAgentResponse),
      timeout,
    ]);
    if (outcome === "timeout") return { ...empty, thrown: null, timedOut: true };
    return { ...outcome, thrown: null, timedOut: false };
  } catch (error) {
    return { ...empty, thrown: error instanceof Error ? error.message : String(error), timedOut: false };
  } finally {
    clearTimeout(timer);
    restoreNetwork?.();
    activeFetch = null;
    vi.unstubAllEnvs();
  }
}
