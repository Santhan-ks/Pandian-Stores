import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

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

const pool = new Pool({ connectionString });

try {
  await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  console.log(
    `Migrations applied to ${isTest ? "test" : "application"} database.`,
  );
} finally {
  await pool.end();
}
