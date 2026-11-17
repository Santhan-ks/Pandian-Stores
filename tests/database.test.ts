import { afterAll, expect, test } from "vitest";
import { Pool } from "pg";

const connectionString = process.env.TEST_DATABASE_URL;

if (!connectionString) {
  throw new Error("TEST_DATABASE_URL is required for database tests");
}
if (connectionString === process.env.DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL");
}

const pool = new Pool({ connectionString });

afterAll(async () => {
  await pool.end();
});

test("the isolated test database has the applied foundation migration", async () => {
  const result = await pool.query<{ ready: boolean }>(
    "select to_regclass('nova.system_settings') is not null as ready",
  );
  expect(result.rows[0]?.ready).toBe(true);
});
