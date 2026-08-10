import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Vitest does not read .env, and CI supplies the real environment, which must win over the file.
// process.loadEnvFile() does not override variables already present — measured — which is exactly
// the precedence wanted. Do not reach for `loadEnv`: it is not exported by `vitest/config`, and the
// `vite` package that does export it is only an override here, resolving by hoisting alone.
try {
  process.loadEnvFile();
} catch {
  /* no .env — CI's environment is the source there */
}

// A second Vitest project for checks that are deliberately NOT hermetic. It is kept strictly apart
// from `npm test`: the unit suite's include glob is src/**, this one lives in tests/, so neither
// config can match the other's files and the F-01 gate stays fast and offline.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // One shared pair of fixture accounts: files must not run against them concurrently.
    fileParallelism: false,
    // Network plus auth round trips against a hosted project in Frankfurt.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // No passWithNoTests, deliberately: a glob that stops matching must go red, not green.
    env: { ...process.env },
  },
});
