import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't let `next dev` write into AGENTS.md: it is a lead-only shared file
  // (docs/agent-workflow.md section 3.3).
  agentRules: false,
  // react-pdf / pdfjs-dist ship ESM with an optional "canvas" dep that is only
  // for Node rendering; stub it so the browser bundle does not pull it in.
  turbopack: { resolveAlias: { canvas: "./components/pdf/empty-module.ts" } },
  // The agent route streams Server-Sent Events, so a proxy in front of it must
  // not time out mid-run while the model is still thinking.
  experimental: { proxyTimeout: 300_000 },
};

export default nextConfig;
