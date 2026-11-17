import { beforeAll, afterAll, test, expect } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import * as schema from "../src/lib/db/schema";
import { seedDemo } from "../scripts/seed-data";
import { inventoryFixture } from "../scripts/inventory-fixture";
import {
  createDocument,
  postDocument,
  readInventory,
  reviseDraft,
} from "../src/modules/inventory/service";
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  url === process.env.DATABASE_URL ||
  !new URL(url).pathname.endsWith("_test")
)
  throw new Error("Isolated test DB required");
const pool = new Pool({ connectionString: url });
const db = drizzle(pool, { schema });
const admin = { id: "demo-admin", role: "admin" } as const;
beforeAll(async () => {
  await db.execute(
    sql`TRUNCATE nova.users,nova.roles,nova.units,nova.inventory_items,nova.territories CASCADE`,
  );
  await seedDemo(db, process.env.DEMO_PASSWORD ?? randomUUID());
  await inventoryFixture(db);
}, 30000);
afterAll(() => pool.end());
const input = (
  lines: {
    itemId: string;
    quantity: string;
    unit: string;
    unitRate: string | null;
  }[],
  category = "adjustment",
) => ({
  category,
  lines,
  supplierId: category === "purchase" ? "demo-flour-supplier" : null,
  reason: "Explicit integration test adjustment",
  requestKey: randomUUID(),
});
test("benchmark receipts, unknown finished value, weighted average and repeated seeding", async () => {
  await inventoryFixture(db);
  await inventoryFixture(db);
  const data = await readInventory(db, admin);
  for (const [id, quantity] of Object.entries({
    "demo-flour": "160000",
    "demo-oil": "30000",
    "demo-spice": "5000",
    "demo-pouch": "500",
    "demo-carton": "30",
    "demo-finished": "50",
  }))
    expect(
      new Decimal(String(data.summary.find((r) => r.id === id)?.quantity)).eq(
        quantity,
      ),
    ).toBe(true);
  const flour = data.summary.find((r) => r.id === "demo-flour")!;
  expect(new Decimal(String(flour.value)).eq("6900")).toBe(true);
  expect(new Decimal(String(flour.average_rate)).mul(1000).eq("43.125")).toBe(
    true,
  );
  expect(data.summary.find((r) => r.id === "demo-finished")?.value).toBeNull();
  expect(data.ledger).toHaveLength(7);
});
test("idempotent drafts, double posting and conflicting keys", async () => {
  const request = input(
    [
      {
        itemId: "demo-flour",
        quantity: "0.001",
        unit: "kg",
        unitRate: "45.125",
      },
    ],
    "purchase",
  );
  const id = await createDocument(db, admin, request);
  await reviseDraft(db, admin, id, request);
  expect(await createDocument(db, admin, request)).toBe(id);
  await Promise.all([postDocument(db, admin, id), postDocument(db, admin, id)]);
  await expect(reviseDraft(db, admin, id, request)).rejects.toMatchObject({
    status: 409,
  });
  expect(
    (
      await db.execute(
        sql`SELECT * FROM nova.inventory_movements WHERE document_id=${id}`,
      )
    ).rows,
  ).toHaveLength(1);
  expect(
    (
      await db.execute(
        sql`SELECT value FROM nova.inventory_movements WHERE document_id=${id}`,
      )
    ).rows[0].value,
  ).toBe("0.045125");
  await expect(
    createDocument(db, admin, { ...request, reason: "Conflicting payload" }),
  ).rejects.toMatchObject({ status: 409 });
});
test("negative stock rejects and concurrent issues serialize", async () => {
  const a = await createDocument(
    db,
    admin,
    input([
      { itemId: "demo-pouch", quantity: "-400", unit: "piece", unitRate: null },
    ]),
  );
  const b = await createDocument(
    db,
    admin,
    input([
      { itemId: "demo-pouch", quantity: "-400", unit: "piece", unitRate: null },
    ]),
  );
  const outcomes = await Promise.allSettled([
    postDocument(db, admin, a),
    postDocument(db, admin, b),
  ]);
  expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
  expect(
    (
      await db.execute(
        sql`SELECT quantity FROM nova.stock_summary WHERE id='demo-pouch'`,
      )
    ).rows[0].quantity,
  ).toMatch(/^100(?:\.0+)?$/);
});
test("one bad line rolls back all movement and status writes", async () => {
  const id = await createDocument(
    db,
    admin,
    input([
      { itemId: "demo-carton", quantity: "1", unit: "piece", unitRate: null },
      { itemId: "demo-spice", quantity: "-999", unit: "kg", unitRate: null },
    ]),
  );
  await expect(postDocument(db, admin, id)).rejects.toThrow();
  expect(
    (
      await db.execute(
        sql`SELECT * FROM nova.inventory_movements WHERE document_id=${id}`,
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await db.execute(
        sql`SELECT status FROM nova.stock_documents WHERE id=${id}`,
      )
    ).rows[0].status,
  ).toBe("draft");
  const incompatible = await createDocument(
    db,
    admin,
    input([{ itemId: "demo-flour", quantity: "1", unit: "L", unitRate: null }]),
  );
  await expect(postDocument(db, admin, incompatible)).rejects.toThrow();
});
test("immutability, traceability, audit and reconciliation", async () => {
  await expect(
    db.execute(sql`UPDATE nova.inventory_movements SET quantity=0`),
  ).rejects.toThrow();
  await expect(
    db.execute(sql`DELETE FROM nova.stock_documents WHERE status='posted'`),
  ).rejects.toThrow();
  await expect(
    db.execute(sql`UPDATE nova.stock_document_lines SET quantity=1`),
  ).rejects.toThrow();
  const mismatch = await db.execute(
    sql`SELECT s.id FROM nova.stock_summary s WHERE s.quantity <> (SELECT coalesce(sum(quantity),0) FROM nova.inventory_movements WHERE item_id=s.id)`,
  );
  expect(mismatch.rows).toHaveLength(0);
  const audit = await db.execute(
    sql`SELECT * FROM nova.audit_events WHERE action='stock.post'`,
  );
  expect(audit.rows.length).toBeGreaterThanOrEqual(4);
});
test("authorization and opening-stock duplication prevention", async () => {
  await expect(
    readInventory(db, { id: "demo-salesman-a", role: "salesman" }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(readInventory(db, null)).rejects.toMatchObject({ status: 401 });
  const req = input(
    [{ itemId: "demo-flour", quantity: "1", unit: "kg", unitRate: "42" }],
    "opening",
  );
  await expect(
    createDocument(db, { id: "demo-auditor", role: "auditor" }, req),
  ).rejects.toMatchObject({ status: 403 });
  const id = await createDocument(db, admin, req);
  await expect(postDocument(db, admin, id)).rejects.toThrow();
});
