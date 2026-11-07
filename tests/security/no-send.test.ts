/**
 * Security: no route can submit or send anything.
 *
 * A static scan of app/, lib/, components/ (and pages/, src/ if they ever appear),
 * enforced from day one: it passes trivially while those folders are empty and
 * starts biting the moment someone adds a send path. The scanner is proven against
 * fixture trees: unsafe/ must trip every rule, safe/ must trip none.
 *
 * To add a route on purpose, add it to ROUTE_ALLOWLIST below in the same PR, with a
 * reviewer. To clear a false positive on a file name, add the path to NAME_ALLOWLIST.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./helpers/route-harness";
import { DEFAULT_ROUTE_ALLOWLIST, scanTree, stripComments } from "./helpers/scan";

const ROUTE_ALLOWLIST = DEFAULT_ROUTE_ALLOWLIST; // ["app/api/agent/route.ts"]
const NAME_ALLOWLIST: string[] = [];
const FIXTURES = join(REPO_ROOT, "tests/security/fixtures/scan");
const scanFixture = (tree: "safe" | "unsafe") =>
  scanTree(join(FIXTURES, tree), { fixtureSuffix: ".fixture", routeAllowlist: ROUTE_ALLOWLIST });

describe("no-send scanner: real source tree", () => {
  it("finds no submit/send capability in app/, lib/, components/", () => {
    expect(scanTree(REPO_ROOT, { routeAllowlist: ROUTE_ALLOWLIST, nameAllowlist: NAME_ALLOWLIST })).toEqual([]);
  });
});

describe("no-send scanner: proven against fixtures", () => {
  it("reports nothing for the safe tree", () => {
    expect(scanFixture("safe")).toEqual([]);
  });

  const expected: Array<[string, string]> = [
    ["forbidden-name", "app/api/submit/route.ts"],
    ["route-not-allowlisted", "app/api/submit/route.ts"],
    ["server-network-call", "app/api/agent/route.ts"],
    ["network-import", "app/api/agent/route.ts"],
    ["messaging-import", "lib/agent/notify.ts"],
    ["messaging-import", "lib/util/aws.ts"],
    ["send-capability", "lib/agent/beacon.ts"],
    ["server-network-call", "lib/agent/beacon.ts"],
    ["send-capability", "components/ContactCity.tsx"],
    ["forbidden-name", "components/SendToCity.tsx"],
    ["send-capability", "app/actions.ts"],
  ];

  it.each(expected)("reports [%s] in %s", (rule, path) => {
    const hits = scanFixture("unsafe").filter((v) => v.startsWith(`[${rule}] ${path}:`));
    expect(hits, `expected a [${rule}] violation for ${path}`).not.toEqual([]);
  });

  it("reports each specific send capability in the unsafe tree", () => {
    const all = scanFixture("unsafe").join("\n");
    for (const needle of [
      'imports "nodemailer"',
      'imports "twilio"',
      'imports "@aws-sdk/client-ses"',
      'server code imports "axios"',
      'server code imports "node:https"',
      "uses fetch(",
      "uses WebSocket",
      "navigator.sendBeacon",
      "mailto:/sms: link",
      "form action posting to an external URL",
      '"use server"',
    ]) {
      expect(all).toContain(needle);
    }
  });

  it("ignores comments but keeps strings", () => {
    expect(stripComments('a // fetch(\nb /* mailto: */ c "// kept"')).toBe('a \nb  c "// kept"');
  });
});
