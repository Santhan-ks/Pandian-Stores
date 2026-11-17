import "dotenv/config";
import { defineConfig } from "@playwright/test";
const database = process.env.TEST_DATABASE_URL;
if (
  !database ||
  database === process.env.DATABASE_URL ||
  !new URL(database).pathname.endsWith("_test")
)
  throw new Error("Use an isolated _test database.");
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://localhost:3100",
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: "npm run start -- --port 3100",
    url: "http://localhost:3100/login",
    reuseExistingServer: false,
    env: {
      DATABASE_URL: database,
      NOVA_ALLOW_DEMO_INVOICES: "true",
      BETTER_AUTH_URL: "http://localhost:3100",
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ??
        "isolated-e2e-test-secret-32-characters-long",
    },
  },
});
