import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't let `next dev` write into AGENTS.md: it's a lead-only shared file (docs/agent-workflow.md §3.3).
  agentRules: false,
  // react-pdf / pdfjs-dist ship ESM with an optional "canvas" dep we never use in the browser.
  turbopack: { resolveAlias: { canvas: "./components/pdf/empty-module.ts" } },
};

export default nextConfig;
