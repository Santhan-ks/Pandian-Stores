import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../src/lib/db/schema";
import { seedDemo } from "./seed-data";
if (
  process.env.NOVA_ALLOW_DEMO_SEED !== "true" ||
  process.env.NODE_ENV === "production"
)
  throw new Error(
    "Demo seeding requires NOVA_ALLOW_DEMO_SEED=true outside production.",
  );
const test = process.argv.includes("--test");
const url = process.env[test ? "TEST_DATABASE_URL" : "DATABASE_URL"];
if (!url || (test && url === process.env.DATABASE_URL))
  throw new Error("Provide a separate test database.");
const pool = new Pool({ connectionString: url });
try {
  await seedDemo(drizzle(pool, { schema }), process.env.DEMO_PASSWORD ?? "");
  console.log("Demo masters seeded; existing records and passwords preserved.");
} finally {
  await pool.end();
}
