import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // No network in tests. Every test runs against fixtures or a stub client.
    env: { ANTHROPIC_API_KEY: "" },
  },
});
