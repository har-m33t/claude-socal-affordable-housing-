import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    // .tsx so Team 2's component tests are picked up alongside the rest.
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
    // Component tests under tests/ui/** need a DOM. Setting it here means a new
    // UI test does not have to remember a // @vitest-environment jsdom
    // docblock; an explicit docblock still takes precedence.
    environmentMatchGlobs: [["tests/ui/**", "jsdom"]],
    // No network in tests. Every suite runs against fixtures or a stub client,
    // and an empty key means a stray live call fails loudly instead of billing.
    env: { ANTHROPIC_API_KEY: "" },
  },
});
