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

/**
 * Output cap per streaming call. 32000, not the full window: Team 4's route
 * checklist asserts 32000 or less, and a smaller cap means a truncated turn
 * costs less. The step cap stays at 12.
 */
export const DEFAULT_MAX_TOKENS = 32_000;

/** A run is capped at this many assistant turns. */
export const DEFAULT_MAX_STEPS = 12;

/** Agent runs allowed per client per window. */
export const DEFAULT_RATE_LIMIT_MAX = 5;
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Live runs allowed across ALL clients combined, per window.
 *
 * This is the actual spend ceiling. The per-client cap is keyed on a header a
 * caller controls, so on its own it can be reset by rotating that header; this
 * counter cannot be reached from a request at all.
 */
export const DEFAULT_RATE_LIMIT_GLOBAL_MAX = 20;

/** Effort lives inside `output_config`, not at the top level. */
export const DEFAULT_EFFORT = "medium" as const;

export interface RateLimitConfig {
  /** Per-client cap. */
  max: number;
  /** Cap across every client combined. */
  globalMax: number;
  windowMs: number;
}

export interface AgentConfig {
  /** null when ANTHROPIC_API_KEY is unset or empty. Never a placeholder. */
  apiKey: string | null;
  caps: AgentCaps;
  /** Absolute or cwd-relative path to the handbook PDF, or null. */
  handbookPdfPath: string | null;
  rateLimit: RateLimitConfig;
  trustProxy: boolean;
}

/**
 * The ONLY read of the API key in this codebase lane.
 * Returns null rather than throwing so the route can answer 503 with a clear
 * message.
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

/** Caps on live runs, overridable for a demo or a load test. */
export function readRateLimit(): RateLimitConfig {
  return {
    max: positiveInt(process.env.POINTER_RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_MAX),
    globalMax: positiveInt(
      process.env.POINTER_RATE_LIMIT_GLOBAL_MAX,
      DEFAULT_RATE_LIMIT_GLOBAL_MAX,
    ),
    windowMs: positiveInt(process.env.POINTER_RATE_LIMIT_WINDOW_MS, DEFAULT_RATE_LIMIT_WINDOW_MS),
  };
}

/**
 * Whether to believe x-forwarded-for / x-real-ip when identifying a client.
 *
 * Off by default, so the default configuration is the safe one: with no proxy
 * in front of the app those headers are attacker-supplied and a caller could
 * hand itself a fresh per-client allowance per request. Set it only when a
 * trusted reverse proxy is actually setting them.
 */
export function trustProxyHeaders(): boolean {
  return process.env.POINTER_TRUST_PROXY === "1";
}

export function loadConfig(): AgentConfig {
  return {
    apiKey: readApiKey(),
    caps: readCaps(),
    handbookPdfPath: readHandbookPdfPath(),
    rateLimit: readRateLimit(),
    trustProxy: trustProxyHeaders(),
  };
}
