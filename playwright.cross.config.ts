import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testDir: "./tests/cross",
  timeout: 60000,
  use: { ...base.use, baseURL: "http://localhost:3400" },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3400",
    url: "http://localhost:3400/login",
    reuseExistingServer: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL!,
      BETTER_AUTH_URL: "http://localhost:3400",
      NOVA_ALLOW_DEMO_INVOICES: "true",
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ??
        "isolated-cross-test-secret-at-least-32-characters",
    },
  },
});
