import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // react-pdf / pdfjs-dist ship ESM with an optional "canvas" dep we never use in the browser.
  turbopack: { resolveAlias: { canvas: "./components/pdf/empty-module.ts" } },
};

export default nextConfig;
