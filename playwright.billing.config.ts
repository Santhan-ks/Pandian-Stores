import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const origin = "http://localhost:3300";
export default defineConfig({
  ...base,
  testDir: "./tests/billing",
  use: { ...base.use, baseURL: origin },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3300",
    url: origin + "/login",
    reuseExistingServer: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL!,
      BETTER_AUTH_URL: origin,
      NOVA_ALLOW_DEMO_INVOICES: "true",
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ??
        "isolated-billing-secret-at-least-32-characters",
    },
  },
});
