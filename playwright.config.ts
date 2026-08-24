import { defineConfig, devices } from "playwright/test";
import { existsSync } from "node:fs";

// Load .env so the test process (which seeds via src/db/client) has
// DATABASE_URL / REDIS_URL / AUTH_SECRET. Workers inherit this process env.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
