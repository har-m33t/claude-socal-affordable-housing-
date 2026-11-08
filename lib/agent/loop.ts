/**
 * Lane `agent-loop`: the Claude tool loop.
 *
 * Shape: `runAgent(request, deps)` is an async generator of StreamFrame. The
 * route pipes it into SSE; a test drives it directly. Everything the loop does
 * not own - the five tools, the input validator, the citation verifier, the
 * recorder, the replay reader, the Anthropic client - arrives as an injected
 * dependency with a lazy default, so this file compiles and its tests pass
 * with the other lanes' files absent.
 *
 * Hard rules this file enforces, in order:
 *  1. replay runs never construct an Anthropic client;
 *  2. a city or project-type pack with verified:false produces a refusal and
 *     no advice, checked before anything else and before any API call;
 *  3. the API key comes from config.readApiKey() and nowhere else;
 *  4. no tool_use block is trusted: every input goes through
 *     validateToolInput, every resulting event through verifyEvent;
 *  5. all tool results for one assistant turn go back in ONE user message;
 *  6. the loop stops at caps.maxSteps, on refusal, on abort.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { APIError } from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import * as nodePath from "node:path";

// Wired statically by the lead at integration. These were loaded through a
// `string`-typed dynamic specifier while the three lanes were built in
// parallel, so `tsc` would not resolve files a lane did not own. A bundler
// cannot follow an expression specifier, so a Next build needs them static.
import { TOOL_DEFINITIONS, validateToolInput } from "./tools";
import { verifyEvent } from "./verifier";
// Namespace import, not named: `resolveStatuteId` and `loadStatuteTable` are
// landing in lane `agent-verifier` in parallel with this change. Reading them
// off the namespace keeps this lane compiling before they exist, and picks up
// the real functions the moment they land. Both paths FAIL CLOSED when absent.
import * as verifierModule from "./verifier";
import { createRecorder } from "./recorder";
import { loadReplay } from "./replay";
import { loadPlansForCity, mergePlanTargets } from "../plan/load";
import type { Plan } from "../../components/pointer/plan";

import {
  DEFAULT_EFFORT,
  MODEL,
  readApiKey,
  readCaps,
  readHandbookPdfPath,
  REPLAY_PATH,
} from "./config";
import { buildSystemBlocks, buildUserContent } from "./prompt";
import type { AgentDocument } from "./prompt";
import type {
  AgentCaps,
  AgentEvent,
  AgentRunRequest,
  CityConfig,
  ProjectTypePack,
  RecorderHandle,
  StatuteEntry,
  StatuteResolution,
  StreamFrame,
  ValidationResult,
  VerifyResult,
} from "./types";

// ----------------------------------------------------------- lane interfaces
// Local structural aliases, NOT imports: lib/agent/{tools,verifier,recorder,
// replay}.ts belong to other lanes and may not exist yet. The shapes below are
// the frozen signatures from types.ts.

/** lib/agent/tools.ts (lane `agent-tools`). */
export interface ToolsLike {
  TOOL_DEFINITIONS: Anthropic.Tool[];
  validateToolInput(name: string, input: unknown, city: CityConfig): ValidationResult;
}

/** lib/agent/verifier.ts (lane `agent-verifier`). */
export interface VerifierLike {
  verifyEvent(event: AgentEvent, statutes: StatuteEntry[]): VerifyResult;
  /**
   * Resolves a model-supplied id against the table. Optional only while lane
   * `agent-verifier` lands it; when it is missing, a call carrying a
   * statute_id is DROPPED rather than emitted without its reference.
   */
  resolveStatuteId?: (id: string, statutes: StatuteEntry[]) => StatuteResolution;
  /** Accepts a bare array or Team 1's {about, statutes:[...]} wrapper. */
  loadStatuteTable?: (raw: unknown) => StatuteEntry[];
}

/** lib/agent/recorder.ts (lane `agent-verifier`). */
export type RecorderFactory = () => RecorderHandle | Promise<RecorderHandle>;

/** lib/agent/replay.ts (lane `agent-verifier`). */
export type ReplayLoader = (path: string) => Promise<StreamFrame[]>;

/** The slice of the Anthropic client this loop uses. Stubbable in a test. */
export interface MessageStreamLike {
  finalMessage(): Promise<Anthropic.Message>;
}
export interface AnthropicClientLike {
  messages: {
    stream(
      body: Anthropic.MessageStreamParams,
      options?: { signal?: AbortSignal },
    ): MessageStreamLike;
  };
}
export type ClientFactory = (apiKey: string) => AnthropicClientLike | Promise<AnthropicClientLike>;

export interface HandbookAttachment {
  /** base64 with no newlines. */
  base64: string;
  title: string;
}

/**
 * What the route hands the loop.
 *
 * `documents` replaces the old manifest-only `packet`, per issue #3. The
 * frozen AgentRunRequest in types.ts still declares `packet` and has no
 * `documents` field, so this lane extends it locally rather than editing a
 * lead-owned file; types.ts needs a follow-up to match.
 */
export interface AgentRunInput extends Omit<AgentRunRequest, "packet"> {
  documents?: AgentDocument[];
}

export interface AgentRunDeps {
  tools?: ToolsLike;
  verifier?: VerifierLike;
  recorder?: RecorderFactory;
  loadReplay?: ReplayLoader;
  createClient?: ClientFactory;
  /**
   * Loads the city file. When injected, its checklist is used as given and
   * plans come only from `loadPlans` (none when that is absent too), so a test
   * that injects a city controls the whole item_id allowlist.
   */
  loadCity?: (city: string) => Promise<CityConfig>;
  /** The city's step-by-step plans. Defaults to data/plans/<slug>-*.json. */
  loadPlans?: (city: string) => Promise<Plan[]>;
  loadPack?: (projectType: string) => Promise<ProjectTypePack>;
  loadStatutes?: () => Promise<StatuteEntry[]>;
  readHandbook?: () => Promise<HandbookAttachment | null>;
  caps?: AgentCaps;
  signal?: AbortSignal;
  now?: () => string;
  /** Root that data/ and fixtures/ hang off. Defaults to process.cwd(). */
  appRoot?: string;
  replayPath?: string;
  model?: string;
}

/** Consecutive unparseable-tool-input turns tolerated before giving up. */
export const MAX_PARSE_RETRIES = 2;

// -------------------------------------------------------------- lane wiring
// Resolved at module load now that every lane has landed. `deps` still wins,
// so tests keep injecting stubs; these are only the defaults.
const LANE_TOOLS: ToolsLike = { TOOL_DEFINITIONS, validateToolInput };
const LANE_EXTRAS = verifierModule as unknown as {
  resolveStatuteId?: VerifierLike["resolveStatuteId"];
  loadStatuteTable?: VerifierLike["loadStatuteTable"];
};
const LANE_VERIFIER: VerifierLike = {
  verifyEvent,
  ...(typeof LANE_EXTRAS.resolveStatuteId === "function"
    ? { resolveStatuteId: LANE_EXTRAS.resolveStatuteId }
    : {}),
  ...(typeof LANE_EXTRAS.loadStatuteTable === "function"
    ? { loadStatuteTable: LANE_EXTRAS.loadStatuteTable }
    : {}),
};
const LANE_REPLAY: ReplayLoader = loadReplay;
const LANE_RECORDER: RecorderFactory = createRecorder;

// ----------------------------------------------------------------- data load

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** City and type names come from the request body, so never touch the path raw. */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function readJsonFile<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

/**
 * The city file, with the city's plan targets (ADU Express form fields, other
 * city PDFs) merged into its checklist so they are valid item_ids too. The
 * verified flag, sources and fast paths come from the city file alone.
 */
export async function loadCityFromDisk(appRoot: string, city: string): Promise<CityConfig> {
  return (await loadCityWithPlans(appRoot, city)).city;
}

/** The merged city and the plans it was merged with: the prompt walks the plans. */
export async function loadCityWithPlans(
  appRoot: string,
  city: string,
): Promise<{ city: CityConfig; plans: Plan[] }> {
  const slug = slugify(city);
  if (!SLUG.test(slug)) throw new Error("unusable city name");
  const config = await readJsonFile<CityConfig>(nodePath.join(appRoot, "data", "cities", `${slug}.json`));
  const plans = await loadPlansForCity(appRoot, slug);
  return { city: mergePlanTargets(config, plans), plans };
}

export async function loadPackFromDisk(
  appRoot: string,
  projectType: string,
): Promise<ProjectTypePack> {
  const slug = slugify(projectType);
  if (!SLUG.test(slug)) throw new Error("unusable project type");
  return readJsonFile<ProjectTypePack>(nodePath.join(appRoot, "data", "types", `${slug}.json`));
}

/**
 * Reads data/statutes.json and interprets it with the lane's loadStatuteTable,
 * never a cast: Team 1's real file uses the {about, statutes:[...]} wrapper
 * form and a cast would silently produce an empty or wrong table.
 *
 * When loadStatuteTable has not landed yet, a bare array is accepted as-is and
 * anything else yields an EMPTY table, so every statute_id then fails to
 * resolve rather than resolving against a half-read file.
 */
export async function loadStatutesFromDisk(
  appRoot: string,
  loadStatuteTable?: (raw: unknown) => StatuteEntry[],
): Promise<StatuteEntry[]> {
  const raw: unknown = JSON.parse(
    await readFile(nodePath.join(appRoot, "data", "statutes.json"), "utf8"),
  );
  if (typeof loadStatuteTable === "function") return loadStatuteTable(raw);
  // Fallback understands both shapes itself. Returning [] for the wrapper would
  // silently disable every statute_id rather than fail loudly.
  if (Array.isArray(raw)) return raw as StatuteEntry[];
  if (raw !== null && typeof raw === "object" && Array.isArray((raw as { statutes?: unknown }).statutes)) {
    return (raw as { statutes: StatuteEntry[] }).statutes;
  }
  return [];
}

/** The handbook is optional. Absent is a status frame, never a fabrication. */
export async function readHandbookFromDisk(appRoot: string): Promise<HandbookAttachment | null> {
  const configured = readHandbookPdfPath();
  if (configured === null) return null;
  const abs = nodePath.isAbsolute(configured) ? configured : nodePath.join(appRoot, configured);
  try {
    const buf = await readFile(abs);
    if (buf.byteLength === 0) return null;
    return {
      // Buffer base64 has no line breaks, but the API rejects any that slip in.
      base64: buf.toString("base64").replace(/\s+/g, ""),
      title: nodePath.basename(abs),
    };
  } catch {
    return null;
  }
}

/** Default client factory. Only ever called on a non-replay run with a key. */
const defaultClientFactory: ClientFactory = async (apiKey: string) => {
  const mod = await import("@anthropic-ai/sdk");
  const Ctor = mod.default;
  return new Ctor({ apiKey }) as unknown as AnthropicClientLike;
};

// --------------------------------------------------------------------- frames

function status(
  phase: "started" | "step" | "done" | "stopped",
  detail?: string,
  step?: number,
): StreamFrame {
  const frame: StreamFrame = { type: "status", phase };
  if (step !== undefined) frame.step = step;
  if (detail !== undefined) frame.detail = detail;
  return frame;
}

function error(code: string, message: string): StreamFrame {
  return { type: "error", code, message };
}

/** Request text echoed into a frame is clamped; frames reach the browser. */
function short(value: string, max = 80): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

/**
 * Put the last cache breakpoint of the tools block on the final tool, unless
 * lane `agent-tools` already placed one. Never mutates their array.
 */
function cacheTools(defs: Anthropic.Tool[]): Anthropic.Tool[] {
  if (defs.length === 0) return defs;
  if (defs.some((d) => (d as { cache_control?: unknown }).cache_control != null)) return defs;
  const copy = defs.slice();
  const last = copy[copy.length - 1];
  if (last === undefined) return defs;
  copy[copy.length - 1] = { ...last, cache_control: { type: "ephemeral" } };
  return copy;
}


/**
 * Shape guard for an id the model named. An id is a LOOKUP KEY, never law, and
 * the resolver fails closed on anything it does not know - but a key still has
 * to look like a key before it is used as one.
 */
const STATUTE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Pull the statute_id the model passed out of one validated tool call.
 *
 * ASSUMPTION, to be reconciled with lane `agent-tools`: that lane validates
 * statute_id's SHAPE and has not yet published where it surfaces the parsed
 * value. This reads, in order, an extra `statute_id` on the success result, a
 * `statute_id` on a parsed `input` the result may carry, one left on the event
 * itself, and finally the raw tool input - each behind the shape guard above.
 * Whichever lands, the value is only ever used as a table key: the statute_ref
 * on the event is copied from the resolver's answer, never from here.
 */
function readStatuteId(validated: { event: AgentEvent }, rawInput: unknown): string | null {
  const candidates: unknown[] = [
    (validated as { statute_id?: unknown }).statute_id,
    (validated as { input?: { statute_id?: unknown } }).input?.statute_id,
    (validated.event as { statute_id?: unknown }).statute_id,
    typeof rawInput === "object" && rawInput !== null
      ? (rawInput as { statute_id?: unknown }).statute_id
      : undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (trimmed === "") continue;
    // Not a valid key: hand it to the resolver's refusal path rather than
    // silently ignoring it, by returning it for the caller to reject.
    return STATUTE_ID.test(trimmed) ? trimmed : trimmed.slice(0, 120);
  }
  return null;
}

/**
 * Project a validated event onto the contract's fields and nothing else.
 *
 * An allowlist, not a blocklist: whatever a permissive validator copies off
 * the model's input - a `statute_ref`, a legacy `citation`, a `source_url`, a
 * field nobody has thought of yet - does not survive. event.schema.json sets
 * additionalProperties:false, so an off-contract key reaching the UI is a bug
 * either way, and `statute_ref` is server-rendered by definition.
 *
 * Keys are copied only when present, so "absent" and "null" stay distinct for
 * item_id, which add_note may legitimately omit.
 */
function onlyContractFields(event: AgentEvent): AgentEvent {
  const clean: AgentEvent = { tool: event.tool, ts: event.ts };
  if ("item_id" in event) clean.item_id = event.item_id;
  if (event.status !== undefined) clean.status = event.status;
  if (event.text !== undefined) clean.text = event.text;
  return clean;
}

// ------------------------------------------------------------------- the run

/**
 * Run the agent. Yields every frame the browser should see.
 *
 * Recording wraps the core so that a recorded replay contains exactly the
 * frames the live run produced, in order.
 */
export async function* runAgent(
  request: AgentRunInput,
  deps: AgentRunDeps = {},
): AsyncGenerator<StreamFrame, void, void> {
  let recorder: RecorderHandle | null = null;
  if (request.record === true) {
    const factory = deps.recorder ?? LANE_RECORDER;
    recorder = await factory();
  }

  for await (const frame of runCore(request, deps)) {
    recorder?.record(frame);
    yield frame;
  }

  if (recorder !== null) {
    try {
      await recorder.save();
    } catch {
      // Never silent: a failed recording is reported, not swallowed.
      yield error("record_failed", "The run finished but the replay file could not be written.");
    }
  }
}

async function* runCore(
  request: AgentRunInput,
  deps: AgentRunDeps,
): AsyncGenerator<StreamFrame, void, void> {
  const appRoot = deps.appRoot ?? process.cwd();
  const signal = deps.signal;
  // A function call, not a property read: TypeScript would otherwise narrow
  // `signal.aborted` to false for the rest of the block and the abort checks
  // after an await would be dead code.
  const aborted = (): boolean => signal?.aborted === true;
  const now = deps.now ?? (() => new Date().toISOString());
  const caps = deps.caps ?? readCaps();
  const model = deps.model ?? MODEL;

  // --- replay: deterministic, offline, and no client is ever constructed.
  if (request.replay === true) {
    const loader = deps.loadReplay ?? LANE_REPLAY;
    let frames: StreamFrame[];
    try {
      frames = await loader(deps.replayPath ?? nodePath.join(appRoot, REPLAY_PATH));
    } catch {
      yield error("replay_read_failed", "The replay file could not be read.");
      return;
    }
    for (const frame of frames) {
      if (aborted()) {
        yield status("stopped", "stopped by the user");
        return;
      }
      yield frame;
    }
    return;
  }

  yield status("started", `${short(request.city, 40)} / ${short(request.projectType, 40)}`);

  // --- load the city and the pack. Nothing here is city-specific.
  let city: CityConfig;
  let plans: Plan[];
  try {
    if (deps.loadCity !== undefined) {
      plans = deps.loadPlans !== undefined ? await deps.loadPlans(request.city) : [];
      city = mergePlanTargets(await deps.loadCity(request.city), plans);
    } else {
      ({ city, plans } = await loadCityWithPlans(appRoot, request.city));
    }
  } catch {
    yield error("city_not_found", `No city configuration exists for "${short(request.city, 60)}".`);
    yield status("stopped", "no city configuration");
    return;
  }

  let pack: ProjectTypePack;
  try {
    pack = await (deps.loadPack ?? ((name: string) => loadPackFromDisk(appRoot, name)))(
      request.projectType,
    );
  } catch {
    yield error(
      "type_not_found",
      `No project-type pack exists for "${short(request.projectType, 60)}".`,
    );
    yield status("stopped", "no project-type pack");
    return;
  }

  // --- THE GATE. First thing after loading. Unverified data produces no
  // advice at all: no API call, no client, no events.
  if (city.verified !== true || pack.verified !== true) {
    const unverified: string[] = [];
    if (city.verified !== true) unverified.push(`the city "${city.city}"`);
    if (pack.verified !== true) unverified.push(`the "${pack.type}" project-type pack`);
    yield error(
      "not_verified",
      `${unverified.join(" and ")} ${unverified.length > 1 ? "are" : "is"} not verified yet, ` +
        "so this prototype will not advise on it. Nobody has read the source checklist and " +
        "recorded a checked date, so every answer would be a guess. Nothing was sent to the model.",
    );
    yield status("stopped", "refused: source data is not verified");
    return;
  }

  // --- the key. config.readApiKey() is the only read, anywhere.
  const apiKey = readApiKey();
  if (apiKey === null) {
    yield error(
      "missing_api_key",
      "ANTHROPIC_API_KEY is not set, so no live run is possible. Use replay mode instead.",
    );
    yield status("stopped", "no API key");
    return;
  }

  // --- the other lanes' modules.
  const tools = deps.tools ?? LANE_TOOLS;
  const verifier = deps.verifier ?? LANE_VERIFIER;

  let statutes: StatuteEntry[];
  try {
    statutes = await (deps.loadStatutes ??
      (() => loadStatutesFromDisk(appRoot, verifier.loadStatuteTable)))();
  } catch {
    statutes = [];
    yield status("step", "The statute map could not be read, so no statute may be cited.");
  }

  // --- the handbook. Absent is normal and is reported, never invented.
  const handbook = await (deps.readHandbook ?? (() => readHandbookFromDisk(appRoot)))();
  if (handbook === null) {
    yield status(
      "step",
      "No handbook PDF was attached on this run, so nothing is quoted or cited from it.",
    );
  }

  const system = buildSystemBlocks({
    city,
    pack,
    statutes,
    handbookAttached: handbook !== null,
    // A plan for another project type would walk the wrong form.
    plans: plans.filter((p) => slugify(p.project_type) === slugify(pack.type)),
  });
  const toolDefs = cacheTools(tools.TOOL_DEFINITIONS);
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: buildUserContent({
        question: request.question,
        documents: request.documents,
        handbookBase64: handbook?.base64,
        handbookTitle: handbook?.title,
        now: now(),
        maxTurns: caps.maxSteps,
      }),
    },
  ];

  const client = await (deps.createClient ?? defaultClientFactory)(apiKey);

  let step = 0;
  let parseFailures = 0;

  while (step < caps.maxSteps) {
    if (aborted()) {
      yield status("stopped", "stopped by the user");
      return;
    }
    step += 1;
    yield status("step", undefined, step);

    let message: Anthropic.Message;
    try {
      const stream = client.messages.stream(
        {
          model,
          max_tokens: caps.maxTokens,
          system,
          tools: toolDefs,
          // A snapshot: the array keeps growing after this call returns.
          messages: [...messages],
          // Effort lives inside output_config. No format: citations forbid it.
          output_config: { effort: DEFAULT_EFFORT },
          // Adaptive or omitted only; disabled/budget_tokens are 400s here.
          thinking: { type: "adaptive" },
          // No temperature, top_p, top_k. No forced tool_choice.
        },
        signal ? { signal } : undefined,
      );
      message = await stream.finalMessage();
    } catch (err) {
      if (aborted()) {
        yield status("stopped", "stopped by the user");
        return;
      }
      // A transport or API failure is not ours to paper over.
      if (err instanceof APIError) throw err;
      // Otherwise: eager input streaming could not parse a tool input at all.
      parseFailures += 1;
      if (parseFailures > MAX_PARSE_RETRIES) {
        yield error(
          "tool_input_unparseable",
          `The model's tool input could not be parsed ${parseFailures} times in a row, so the run stopped.`,
        );
        yield status("stopped", "unparseable tool input");
        return;
      }
      yield status("step", "A tool call arrived unparseable; retrying the turn.", step);
      step -= 1; // a retry is not a step
      continue;
    }
    parseFailures = 0;

    // --- stop reasons that forbid running anything from this turn.
    if (message.stop_reason === "refusal") {
      yield {
        type: "refusal",
        reason:
          "The model declined to continue this turn. No tool call from it was validated or run.",
      };
      yield status("stopped", "refused by the model");
      return;
    }
    if (message.stop_reason === "max_tokens") {
      yield error(
        "max_tokens",
        "The model's turn hit the output cap, so any tool input in it is truncated. Nothing was run.",
      );
      yield status("stopped", "output truncated");
      return;
    }
    if (message.stop_reason === "model_context_window_exceeded") {
      yield error(
        "context_window_exceeded",
        "The conversation outgrew the model's context window, so the run stopped.",
      );
      yield status("stopped", "context window exceeded");
      return;
    }

    messages.push({ role: "assistant", content: message.content });

    // pause_turn: the turn was interrupted mid-flight. Hand it straight back.
    if (message.stop_reason === "pause_turn") continue;

    const toolUses = message.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    if (toolUses.length > 0) {
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        // The tolerant parser can hand back silently truncated input, so
        // use.input is never trusted.
        const validated = tools.validateToolInput(use.name, use.input, city);
        if (!validated.ok) {
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            is_error: true,
            content: validated.error,
          });
          continue; // no frame at all: the UI must not see a rejected call
        }

        // Nothing off-contract survives from the model's own input.
        let candidate = onlyContractFields(validated.event);

        // --- the server renders the law, the model only names it.
        const statuteId = readStatuteId(validated, use.input);
        if (statuteId !== null) {
          if (typeof verifier.resolveStatuteId !== "function") {
            // Fail closed. Emitting the action without its reference would
            // silently drop the law the model was pointing at.
            const reason = "statute resolution is unavailable in this build";
            yield { type: "dropped", reason, event: candidate };
            results.push({
              type: "tool_result",
              tool_use_id: use.id,
              is_error: true,
              content: reason,
            });
            continue;
          }
          const resolved = verifier.resolveStatuteId(statuteId, statutes);
          if (!resolved.ok) {
            yield { type: "dropped", reason: resolved.reason, event: candidate };
            results.push({
              type: "tool_result",
              tool_use_id: use.id,
              is_error: true,
              // The reason names what is wrong with the id so the model can
              // correct it or fall back to "unknown".
              content: `statute_id did not resolve: ${resolved.reason}`,
            });
            continue;
          }
          // Copied field by field from the resolver's answer. Not spread from
          // the model's input, and not merged with it.
          candidate = {
            ...candidate,
            statute_ref: {
              id: resolved.statute.id,
              old: resolved.statute.old,
              new_range: resolved.statute.new_range,
              title: resolved.statute.title,
              source_url: resolved.statute.source_url,
              checked_date: resolved.statute.checked_date,
            },
          };
        }

        // --- the backstop: prose asserting law is dropped, reference or not.
        const verified = verifier.verifyEvent(candidate, statutes);
        if (!verified.ok) {
          yield { type: "dropped", reason: verified.reason, event: candidate };
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            is_error: true,
            content: `Dropped by the law check: ${verified.reason}`,
          });
          continue;
        }
        yield { type: "event", event: verified.event };
        results.push({ type: "tool_result", tool_use_id: use.id, content: "accepted" });
      }
      // ONE user message for the whole turn. Splitting them teaches the model
      // to stop making parallel calls.
      messages.push({ role: "user", content: results });
    }

    if (message.stop_reason !== "tool_use") {
      yield status("done", message.stop_reason ?? undefined);
      return;
    }
  }

  yield status("stopped", `step cap reached (${caps.maxSteps} steps), so the run stopped here`);
}
