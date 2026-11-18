import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import { seedDemo } from "./seed-data";
import { seedDemoCatalog } from "./catalog-fixture";
import { inventoryFixture } from "./inventory-fixture";
import { productionFixture } from "./production-fixture";
import { salesFixture } from "./sales-fixture";
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  url === process.env.DATABASE_URL ||
  !new URL(url).pathname.endsWith("_test")
)
  throw new Error("Review requires an isolated _test database.");
const pool = new Pool({ connectionString: url });
try {
  const db = drizzle(pool, { schema });
  await db.execute(
    sql`TRUNCATE nova.login_attempts,nova.users,nova.roles,nova.units,nova.inventory_items,nova.territories,nova.suppliers CASCADE`,
  );
  process.env.NOVA_ALLOW_DEMO_INVOICES = "true";
  await seedDemo(db, process.env.DEMO_PASSWORD ?? "");
  await seedDemoCatalog(db);
  await inventoryFixture(db);
  await productionFixture(db);
  await salesFixture(db);
  console.log(
    "Isolated role review fixture prepared; application database untouched.",
  );
} finally {
  await pool.end();
}
