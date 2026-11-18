import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { createDatabasePool } from "../src/lib/db/pool";

const isTest = process.argv.includes("--test");
const connectionString =
  process.env[isTest ? "TEST_DATABASE_URL" : "DATABASE_URL"];

if (!connectionString) {
  throw new Error(
    `${isTest ? "TEST_DATABASE_URL" : "DATABASE_URL"} is required`,
  );
}
if (isTest && connectionString === process.env.DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL");
}

const pool = createDatabasePool(connectionString);

try {
  await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  console.log(
    `Migrations applied to ${isTest ? "test" : "application"} database.`,
  );
} catch (error) {
  const cause = error instanceof Error ? (error.cause ?? error) : error;
  console.error("Migration failed; startup stopped.", {
    code: (cause as { code?: string })?.code ?? "unknown",
  });
  process.exitCode = 1;
} finally {
  await pool.end();
}
