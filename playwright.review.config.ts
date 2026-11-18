import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testDir: "./tests/review",
  timeout: 120000,
  use: { ...base.use, baseURL: "http://localhost:3200" },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3200",
    url: "http://localhost:3200/login",
    reuseExistingServer: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL!,
      BETTER_AUTH_URL: "http://localhost:3200",
      NOVA_ALLOW_DEMO_INVOICES: "true",
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ??
        "isolated-review-secret-at-least-32-characters",
    },
  },
});
