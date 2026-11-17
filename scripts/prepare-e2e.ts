import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import { seedDemo } from "./seed-data";
import { inventoryFixture } from "./inventory-fixture";
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  url === process.env.DATABASE_URL ||
  !new URL(url).pathname.endsWith("_test")
)
  throw new Error("Browser fixtures require a dedicated _test database.");
const pool = new Pool({ connectionString: url });
try {
  const db = drizzle(pool, { schema });
  await db.execute(
    sql`TRUNCATE nova.users,nova.roles,nova.units,nova.inventory_items,nova.territories CASCADE`,
  );
  await seedDemo(db, process.env.DEMO_PASSWORD ?? "");
  await inventoryFixture(db);
} finally {
  await pool.end();
}
