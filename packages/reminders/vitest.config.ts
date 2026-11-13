import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // DB integration tests do dozens of sequential writes before asserting
    // (the race test alone takes ~4s on a quiet machine). The 5s vitest
    // default timed the race test out in full-suite runs even though the
    // no-duplicate invariant holds — same 30s as the web config.
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
