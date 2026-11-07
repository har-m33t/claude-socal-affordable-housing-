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

import {
  DEFAULT_EFFORT,
  MODEL,
  readApiKey,
  readCaps,
  readHandbookPdfPath,
  REPLAY_PATH,
} from "./config";
import { buildSystemBlocks, buildUserContent } from "./prompt";
import type {
  AgentCaps,
  AgentEvent,
  AgentRunRequest,
  CityConfig,
  ProjectTypePack,
  RecorderHandle,
  StatuteEntry,
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

export interface AgentRunDeps {
  tools?: ToolsLike;
  verifier?: VerifierLike;
  recorder?: RecorderFactory;
  loadReplay?: ReplayLoader;
  createClient?: ClientFactory;
  loadCity?: (city: string) => Promise<CityConfig>;
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

// -------------------------------------------------------------- lane loading
// INTEGRATION NOTE for the lead: the specifier is held in a `string`-typed
// variable on purpose, so `tsc` does not resolve a file this lane does not own
// and typecheck stays clean in isolation. Once the other lanes have landed,
// replace the three loaders below with plain static imports:
//     import { TOOL_DEFINITIONS, validateToolInput } from "./tools";
//     import { verifyEvent } from "./verifier";
//     import { createRecorder } from "./recorder";
//     import { loadReplay } from "./replay";
// and drop `importLane`. Bundlers cannot follow an expression specifier.
async function importLane(relative: string): Promise<Record<string, unknown> | null> {
  const specifier: string = relative;
  try {
    return (await import(specifier)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function laneTools(): Promise<ToolsLike | null> {
  const mod = await importLane("./tools");
  if (mod === null) return null;
  const defs = mod["TOOL_DEFINITIONS"];
  const validate = mod["validateToolInput"];
  if (!Array.isArray(defs) || typeof validate !== "function") return null;
  return {
    TOOL_DEFINITIONS: defs as Anthropic.Tool[],
    validateToolInput: validate as ToolsLike["validateToolInput"],
  };
}

async function laneVerifier(): Promise<VerifierLike | null> {
  const mod = await importLane("./verifier");
  if (mod === null) return null;
  const verify = mod["verifyEvent"];
  if (typeof verify !== "function") return null;
  return { verifyEvent: verify as VerifierLike["verifyEvent"] };
}

async function laneReplay(): Promise<ReplayLoader | null> {
  const mod = await importLane("./replay");
  if (mod === null) return null;
  const load = mod["loadReplay"];
  return typeof load === "function" ? (load as ReplayLoader) : null;
}

async function laneRecorder(): Promise<RecorderFactory | null> {
  const mod = await importLane("./recorder");
  if (mod === null) return null;
  for (const name of ["createRecorder", "makeRecorder", "newRecorder", "default"]) {
    const candidate = mod[name];
    if (typeof candidate === "function") return candidate as RecorderFactory;
  }
  return null;
}

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

export async function loadCityFromDisk(appRoot: string, city: string): Promise<CityConfig> {
  const slug = slugify(city);
  if (!SLUG.test(slug)) throw new Error("unusable city name");
  return readJsonFile<CityConfig>(nodePath.join(appRoot, "data", "cities", `${slug}.json`));
}

export async function loadPackFromDisk(
  appRoot: string,
  projectType: string,
): Promise<ProjectTypePack> {
  const slug = slugify(projectType);
  if (!SLUG.test(slug)) throw new Error("unusable project type");
  return readJsonFile<ProjectTypePack>(nodePath.join(appRoot, "data", "types", `${slug}.json`));
}

export async function loadStatutesFromDisk(appRoot: string): Promise<StatuteEntry[]> {
  return readJsonFile<StatuteEntry[]>(nodePath.join(appRoot, "data", "statutes.json"));
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

// ------------------------------------------------------------------- the run

/**
 * Run the agent. Yields every frame the browser should see.
 *
 * Recording wraps the core so that a recorded replay contains exactly the
 * frames the live run produced, in order.
 */
export async function* runAgent(
  request: AgentRunRequest,
  deps: AgentRunDeps = {},
): AsyncGenerator<StreamFrame, void, void> {
  let recorder: RecorderHandle | null = null;
  if (request.record === true) {
    const factory = deps.recorder ?? (await laneRecorder());
    if (factory === null) {
      yield error("recorder_unavailable", "Recording was requested but the recorder is missing.");
    } else {
      recorder = await factory();
    }
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
  request: AgentRunRequest,
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
    const loader = deps.loadReplay ?? (await laneReplay());
    if (loader === null) {
      yield error("replay_unavailable", "Replay was requested but the replay reader is missing.");
      return;
    }
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
  try {
    city = await (deps.loadCity ?? ((name: string) => loadCityFromDisk(appRoot, name)))(
      request.city,
    );
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
  const tools = deps.tools ?? (await laneTools());
  if (tools === null) {
    yield error("tools_unavailable", "The tool definitions are not available in this build.");
    yield status("stopped", "tools missing");
    return;
  }
  const verifier = deps.verifier ?? (await laneVerifier());
  if (verifier === null) {
    yield error("verifier_unavailable", "The citation verifier is not available in this build.");
    yield status("stopped", "verifier missing");
    return;
  }

  let statutes: StatuteEntry[];
  try {
    statutes = await (deps.loadStatutes ?? (() => loadStatutesFromDisk(appRoot)))();
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
  });
  const toolDefs = cacheTools(tools.TOOL_DEFINITIONS);
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: buildUserContent({
        question: request.question,
        packet: request.packet,
        handbookBase64: handbook?.base64,
        handbookTitle: handbook?.title,
        now: now(),
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
        const verified = verifier.verifyEvent(validated.event, statutes);
        if (!verified.ok) {
          yield { type: "dropped", reason: verified.reason, event: validated.event };
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            is_error: true,
            content: `Dropped by the citation check: ${verified.reason}`,
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
