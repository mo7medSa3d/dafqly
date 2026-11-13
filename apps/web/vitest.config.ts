import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  // Journeys tests import the public route handlers, which use the same
  // `@/` alias as the Next app (tsconfig paths: `./src/*`, `./app/*` —
  // `@/server/...` resolves to `./src/server/...`).
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["src/**/*.test.ts"], testTimeout: 30000, hookTimeout: 60000 },
});
