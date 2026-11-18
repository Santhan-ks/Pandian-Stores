import { afterAll, test, expect } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { allowLogin } from "../src/modules/auth/login-limit";
import {
  readJson,
  checkOrigin,
  errorResponse,
} from "../src/modules/catalog/http";
import { createDatabasePool } from "../src/lib/db/pool";
import { createAuth } from "../src/modules/auth/auth";
import * as schema from "../src/lib/db/schema";
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  url === process.env.DATABASE_URL ||
  !new URL(url).pathname.endsWith("_test")
)
  throw new Error("Isolated test database required");
const pool = new Pool({ connectionString: url });
const db = drizzle(pool, { schema });
afterAll(() => pool.end());
test("persistent login limits are atomic across concurrent requests and survive new callers", async () => {
  const email = randomUUID() + "@example.test",
    secret = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 12 }, () => allowLogin(db, email, secret)),
  );
  expect(results.filter(Boolean)).toHaveLength(10);
  expect(
    await allowLogin(drizzle(pool, { schema }), email.toUpperCase(), secret),
  ).toBe(false);
  const rows = (await db.execute(sql`SELECT key FROM nova.login_attempts`))
    .rows;
  expect(rows.some((r) => String(r.key).includes(email))).toBe(false);
  await db.execute(
    sql`UPDATE nova.login_attempts SET expires_at=now()-interval '1 second'`,
  );
  expect(await allowLogin(db, email, secret)).toBe(true);
});
test("request limits, malformed JSON and CSRF fail before business processing", async () => {
  const valid = () =>
    new Request("http://localhost:3000/api/sales", {
      method: "POST",
      headers: {
        Origin: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
      },
      body: "{}",
    });
  expect(() => checkOrigin(valid())).not.toThrow();
  expect(() =>
    checkOrigin(
      new Request("http://localhost:3000/api/sales", {
        method: "POST",
        headers: { Origin: "https://untrusted.example" },
        body: "{}",
      }),
    ),
  ).toThrow(/origin/);
  await expect(
    readJson(
      new Request("http://localhost/api", { method: "POST", body: "{" }),
    ),
  ).rejects.toThrow(SyntaxError);
  await expect(
    readJson(
      new Request("http://localhost/api", {
        method: "POST",
        body: "x".repeat(65537),
      }),
    ),
  ).rejects.toThrow(/64 KiB/);
  expect(await readJson(valid())).toEqual({});
});
test("invalid configuration and unavailable database fail without disclosing credentials", async () => {
  expect(() => createDatabasePool("not-a-database-url")).toThrow();
  expect(() => createDatabasePool("https://example.test")).toThrow(
    /PostgreSQL/,
  );
  expect(() => createAuth(db, "too-short", "http://localhost:3100")).toThrow(
    /32/,
  );
  const unavailable = createDatabasePool(
    "postgresql://invalid:never-log-this@127.0.0.1:1/nova_unavailable_test",
  );
  try {
    await expect(unavailable.query("SELECT 1")).rejects.toThrow();
  } finally {
    await unavailable.end();
  }
  const response = errorResponse({
    code: "ECONNREFUSED",
    message: "password never-log-this on internal host",
  });
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("never-log-this");
});
import { spawnSync } from "node:child_process";
test("migration failure exits nonzero and sanitizes startup diagnostics", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/migrate.ts"],
    {
      env: {
        ...process.env,
        DATABASE_URL:
          "postgresql://invalid:disposable-only@127.0.0.1:1/nova_unavailable_test",
      },
      encoding: "utf8",
      timeout: 8000,
    },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Migration failed; startup stopped.");
  expect(result.stderr).not.toContain("disposable-only");
}, 10000);
