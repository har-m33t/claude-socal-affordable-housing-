/**
 * Lane `agent-loop`: run caps, model id and the one place the API key is read.
 *
 * THE KEY RULE: the Anthropic API key is read from the ANTHROPIC_API_KEY
 * environment variable and from nowhere else. No second env var, no dotfile, no
 * function argument, no hardcoded fallback, no default. If the variable is
 * absent or empty the app has no key and must say so instead of guessing.
 * `readApiKey()` below is the only key read in this lane - there is exactly one
 * line of code in the whole lane that touches that variable.
 */
import type { AgentCaps } from "./types";

/** The model the loop runs on. No date suffix. */
export const MODEL = "claude-opus-5-5";

/** Streaming requests use the full window. */
export const DEFAULT_MAX_TOKENS = 64_000;

/** A run is capped at this many assistant turns. */
export const DEFAULT_MAX_STEPS = 12;

/** Live runs allowed per client per window. Replay runs are never limited. */
export const DEFAULT_RATE_LIMIT_MAX = 5;
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

/** Effort lives inside `output_config`, not at the top level. */
export const DEFAULT_EFFORT = "medium" as const;

/** Where replay runs read from, relative to the app root. */
export const REPLAY_PATH = "fixtures/replay.json";

export interface RateLimitConfig {
  max: number;
  windowMs: number;
}

export interface AgentConfig {
  /** null when ANTHROPIC_API_KEY is unset or empty. Never a placeholder. */
  apiKey: string | null;
  caps: AgentCaps;
  /** Absolute or cwd-relative path to the handbook PDF, or null. */
  handbookPdfPath: string | null;
  rateLimit: RateLimitConfig;
  recordingEnabled: boolean;
}

/**
 * The ONLY read of the API key in this codebase lane.
 * Returns null rather than throwing so the route can answer 503 with a clear
 * message, and so replay runs work with no key at all.
 */
export function readApiKey(): string | null {
  const raw = process.env.ANTHROPIC_API_KEY;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function hasApiKey(): boolean {
  return readApiKey() !== null;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

/** Caps, with POINTER_MAX_STEPS / POINTER_MAX_TOKENS overrides. */
export function readCaps(): AgentCaps {
  return {
    maxSteps: positiveInt(process.env.POINTER_MAX_STEPS, DEFAULT_MAX_STEPS),
    maxTokens: positiveInt(process.env.POINTER_MAX_TOKENS, DEFAULT_MAX_TOKENS),
  };
}

/** Optional handbook PDF. Absent is normal: the loop proceeds without it. */
export function readHandbookPdfPath(): string | null {
  const raw = process.env.POINTER_HANDBOOK_PDF;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Per-client cap on live runs, overridable for a demo or a load test. */
export function readRateLimit(): RateLimitConfig {
  return {
    max: positiveInt(process.env.POINTER_RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_MAX),
    windowMs: positiveInt(process.env.POINTER_RATE_LIMIT_WINDOW_MS, DEFAULT_RATE_LIMIT_WINDOW_MS),
  };
}

/**
 * Whether this server may write a replay file.
 *
 * Recording overwrites fixtures/replay.json, which is the demo's fallback when
 * the API or the wifi fails. That makes it an operator decision, never a
 * request parameter: `record` is deliberately absent from the route's body
 * schema, and a body carrying it is rejected as an unknown key.
 *
 * Both conditions must hold: the operator sets the flag, AND this is not a
 * production build. Either one alone is too loose - a bare NODE_ENV check
 * would let every dev run clobber the fixture, and a bare flag could be set
 * in a deployed environment by accident.
 */
export function recordingEnabled(): boolean {
  return process.env.POINTER_ALLOW_RECORD === "1" && process.env.NODE_ENV !== "production";
}

export function loadConfig(): AgentConfig {
  return {
    apiKey: readApiKey(),
    caps: readCaps(),
    handbookPdfPath: readHandbookPdfPath(),
    rateLimit: readRateLimit(),
    recordingEnabled: recordingEnabled(),
  };
}
