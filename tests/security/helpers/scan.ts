/**
 * Static "no route can submit or send anything" scanner.
 *
 * Pure: `scanTree(root, options)` walks the given source roots and returns
 * violations as `[rule] path: detail` strings. The real repo is scanned with the
 * default extensions. Fixture trees under tests/security/fixtures/scan/ store their
 * files with an extra `.fixture` suffix (e.g. `route.ts.fixture`) so that tsc and
 * Next never see them as code; the scanner strips that suffix when asked
 * (`fixtureSuffix`) and then treats each file exactly like a real source file.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export interface ScanOptions {
  /** Directories (relative to root) to scan. Missing ones are skipped. */
  roots?: string[];
  /** Route files allowed to exist, relative to root with forward slashes. */
  routeAllowlist?: string[];
  /** Paths exempt from the forbidden-name rule only, deliberately reviewed. */
  nameAllowlist?: string[];
  /** If set, only files ending in this suffix are scanned, with it stripped. */
  fixtureSuffix?: string;
}

export const DEFAULT_ROOTS = ["app", "lib", "components", "pages", "src"];
export const DEFAULT_ROUTE_ALLOWLIST = ["app/api/agent/route.ts"];
const SOURCE_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const SKIP_DIRS = new Set(["node_modules", ".next", "tests", "test", "__tests__", "__mocks__", "coverage", "dist", "out"]);
const TEST_FILE = /\.(?:test|spec)\.[a-z]+$/;

/** Path segments that suggest submitting or sending (camelCase is split first). */
const FORBIDDEN_NAME = /submit|send|mail|sms|text-message|fax|portal|apply|file-application/;

/** Messaging, webhook and browser-automation packages: forbidden everywhere. */
const MESSAGING_PACKAGES: RegExp[] = [
  /^nodemailer/, /^@sendgrid\//, /^twilio/, /^resend$/, /^postmark$/, /^mailgun(?:\.js|-js)?$/, /^@mailchimp\//,
  /^mandrill/, /^@aws-sdk\/client-(?:ses|sesv2|sns|pinpoint|pinpoint-sms-voice-v2)$/, /^aws-sdk$/, /^@slack\//,
  /^discord\.js$/, /smtp/, /^emailjs$/, /^@emailjs\//, /^sparkpost$/, /^@sparkpost\//, /^@vonage\//, /^vonage$/,
  /^plivo$/, /^messagebird$/, /^telnyx$/, /^pusher$/, /^svix$/, /^@react-email\//, /^react-email$/,
  /^firebase-admin/, /^@google-cloud\/pubsub$/, /^puppeteer/, /^playwright/, /^@playwright\//, /^selenium-webdriver$/,
];

/** HTTP clients and raw network/process modules: forbidden in server code. */
const SERVER_NETWORK_PACKAGES: RegExp[] = [
  /^axios$/, /^got$/, /^undici$/, /^node-fetch$/, /^cross-fetch$/, /^ky$/, /^superagent$/, /^needle$/, /^request$/,
  /^ws$/, /^socket\.io-client$/, /^(?:node:)?(?:http|https|http2|net|tls|dgram|child_process)$/,
];

const SERVER_NETWORK_CALLS: Array<[RegExp, string]> = [
  [/\bfetch\s*\(/, "fetch("],
  [/\bhttps?\s*\.\s*(?:request|get)\s*\(/, "http(s).request/get"],
  [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
  [/\bWebSocket\b/, "WebSocket"],
];

const EVERYWHERE_CALLS: Array<[RegExp, string]> = [
  [/navigator\s*\.\s*sendBeacon/, "navigator.sendBeacon"],
  [/["'`]\s*(?:mailto|sms):/i, "mailto:/sms: link"],
  [/\bfetch\s*\(\s*["'`](?:https?:)?\/\//, "fetch( to an absolute external URL"],
  [/\b(?:action|formAction)\s*=\s*\{?\s*["'`](?:https?:)?\/\//, "form action posting to an external URL"],
  [/^\s*["']use server["'];?/m, "\"use server\" (server actions are POST endpoints)"],
];

const IMPORT_SPECIFIERS = /(?:\bimport\s+(?:[^'"`;]*?\s+from\s+)?|\bexport\s+[^'"`;]*?\s+from\s+|\brequire\s*\(\s*|\bimport\s*\(\s*)["'`]([^"'`]+)["'`]/g;

/**
 * Removes // and /* *\/ comments while leaving string and template literals intact,
 * so a comment that merely mentions fetch( is not a finding.
 */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== c) {
        if (source[j] === "\\") j++;
        if (c !== "`" && source[j] === "\n") break;
        j++;
      }
      out += source.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(full, out);
    } else {
      out.push(full);
    }
  }
}

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/_/g, "-").toLowerCase();

export function scanTree(root: string, options: ScanOptions = {}): string[] {
  const roots = options.roots ?? DEFAULT_ROOTS;
  const routeAllowlist = options.routeAllowlist ?? DEFAULT_ROUTE_ALLOWLIST;
  const nameAllowlist = options.nameAllowlist ?? [];
  const violations: string[] = [];

  for (const top of roots) {
    const topDir = join(root, top);
    if (!existsSync(topDir)) continue;
    const files: string[] = [];
    walk(topDir, files);
    for (const file of files) {
      let rel = relative(root, file).split(sep).join("/");
      if (options.fixtureSuffix) {
        if (!rel.endsWith(options.fixtureSuffix)) continue;
        rel = rel.slice(0, -options.fixtureSuffix.length);
      }
      if (!SOURCE_EXT.test(rel) || TEST_FILE.test(rel)) continue;
      violations.push(...scanFile(rel, readFileSync(file, "utf8"), { routeAllowlist, nameAllowlist }));
    }
  }
  return violations;
}

function scanFile(rel: string, raw: string, opts: { routeAllowlist: string[]; nameAllowlist: string[] }): string[] {
  const found: string[] = [];
  const report = (rule: string, detail: string) => found.push(`[${rule}] ${rel}: ${detail}`);
  const segments = rel.split("/");
  const fileName = segments[segments.length - 1];

  // Route segments under app/ (and pages/), and file names everywhere.
  if (!opts.nameAllowlist.includes(rel)) {
    const named = ["app", "pages", "src"].includes(segments[0]) ? segments.slice(1) : [fileName];
    for (const seg of named) {
      const match = kebab(seg).match(FORBIDDEN_NAME);
      if (match) report("forbidden-name", `path segment "${seg}" contains "${match[0]}"`);
    }
  }

  // Route handlers: only the allowlist may exist.
  if (/^route\.[a-z]+$/.test(fileName) && !opts.routeAllowlist.includes(rel)) {
    report("route-not-allowlisted", `route handler not in the allowlist (${opts.routeAllowlist.join(", ")})`);
  }
  if (segments[0] === "pages" && segments[1] === "api") report("route-not-allowlisted", "pages/api routes are not allowed");

  const code = stripComments(raw);
  const isServer = rel.startsWith("app/api/") || rel.startsWith("lib/agent/") || /^route\.[a-z]+$/.test(fileName);

  for (const match of code.matchAll(IMPORT_SPECIFIERS)) {
    const spec = match[1];
    if (MESSAGING_PACKAGES.some((p) => p.test(spec))) report("messaging-import", `imports "${spec}"`);
    else if (isServer && SERVER_NETWORK_PACKAGES.some((p) => p.test(spec))) report("network-import", `server code imports "${spec}"`);
  }
  if (isServer) {
    for (const [pattern, label] of SERVER_NETWORK_CALLS) {
      if (pattern.test(code)) report("server-network-call", `server code uses ${label}; only the Anthropic SDK may make requests`);
    }
  }
  for (const [pattern, label] of EVERYWHERE_CALLS) {
    if (pattern.test(code)) report("send-capability", label);
  }
  return found;
}
