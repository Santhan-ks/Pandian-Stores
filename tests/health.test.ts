import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/db/connection", () => ({
  getDatabase: () => ({
    execute: async () => {
      throw { code: "ECONNREFUSED" };
    },
  }),
}));
import { GET } from "../src/app/api/health/route";
test("health handler reports controlled database unavailability without internal details", async () => {
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ status: "unavailable" });
  expect(response.headers.get("cache-control")).toBe("no-store");
});
