import { beforeEach, afterAll, test, expect } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "../src/lib/db/schema";
import { seedDemo } from "../scripts/seed-data";
import { seedDemoCatalog } from "../scripts/catalog-fixture";
import { inventoryFixture } from "../scripts/inventory-fixture";
import {
  productionFixture,
  benchmarkProduction,
} from "../scripts/production-fixture";
import { salesFixture } from "../scripts/sales-fixture";
import { saveMaster } from "../src/modules/catalog/service";
import { deleteRecord } from "../src/modules/records/service";
import { createDocument, postDocument } from "../src/modules/inventory/service";
import { createRun, addOverhead } from "../src/modules/production/service";
import { submitOrder, reviewOrder } from "../src/modules/sales/service";
import { AccessError, type Actor } from "../src/modules/auth/policy";
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  url === process.env.DATABASE_URL ||
  !new URL(url).pathname.endsWith("_test")
)
  throw new Error("Isolated _test database required");
const pool = new Pool({ connectionString: url }),
  db = drizzle(pool, { schema });
const admin = { id: "demo-admin", role: "admin" } as const,
  owner = { id: "demo-owner", role: "owner" } as const;
const password = process.env.DEMO_PASSWORD ?? "isolated-test-password";
beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE nova.login_attempts,nova.users,nova.roles,nova.units,nova.inventory_items,nova.territories,nova.suppliers CASCADE`,
  );
  await seedDemo(db, password);
  await inventoryFixture(db);
});
afterAll(() => pool.end());
const rowCount = async (table: string, id: string) =>
  Number(
    (
      await db.execute(
        sql`SELECT count(*)::int AS n FROM ${sql.raw("nova." + table)} WHERE id=${id}`,
      )
    ).rows[0].n,
  );
const input = (requestKey = randomUUID()) => ({
  category: "adjustment",
  supplierId: null,
  reason: "Deletion test draft",
  requestKey,
  lines: [{ itemId: "demo-flour", quantity: "-1", unit: "kg", unitRate: null }],
});
const order = (requestKey = randomUUID()) => ({
  customerId: "demo-retailer-a",
  requestKey,
  lines: [{ productId: "demo-murukku", quantity: "1", rate: "50.00" }],
});

for (const actor of [admin, owner])
  test(`${actor.role} deletes each unused master type with audit and cleanup`, async () => {
    const supplier = await saveMaster(db, admin, "suppliers", {
      name: "Unused supplier",
      state: "Tamil Nadu",
      address: "Fictional test address",
    });
    const territory = await saveMaster(db, admin, "territories", {
      name: "Unused territory",
      salesmanId: "demo-salesman-a",
    });
    const customer = await saveMaster(db, admin, "customers", {
      name: "Unused customer",
      state: "Tamil Nadu",
      address: "Fictional",
      territoryId: territory.id,
    });
    const material = await saveMaster(db, admin, "materials", {
      name: "Unused material",
      kind: "raw",
      baseUnit: "g",
    });
    const product = await saveMaster(db, admin, "products", {
      name: "Unused pack",
      packGrams: "250",
      cartonCapacity: 10,
    });
    const productItem = (
      await db.execute(
        sql`SELECT item_id FROM nova.products WHERE id=${product.id}`,
      )
    ).rows[0].item_id as string;
    const price = await saveMaster(db, admin, "prices", {
      productId: product.id,
      amount: "60",
      gstPercent: "5",
    });
    const user = await saveMaster(db, admin, "users", {
      name: "Unused person",
      email: randomUUID() + "@example.test",
      role: "auditor",
      password,
    });
    for (const [resource, id, table] of [
      ["suppliers", supplier.id, "suppliers"],
      ["customers", customer.id, "customers"],
      ["territories", territory.id, "territories"],
      ["materials", material.id, "inventory_items"],
      ["prices", price.id, "product_prices"],
      ["products", product.id, "products"],
      ["users", user.id, "users"],
    ]) {
      await deleteRecord(db, actor, resource, id);
      expect(await rowCount(table, id)).toBe(0);
      const audit = (
        await db.execute(
          sql`SELECT before,after FROM nova.audit_events WHERE document_id=${id} AND action=${resource + ".delete"}`,
        )
      ).rows;
      expect(audit).toHaveLength(1);
      expect(JSON.stringify(audit)).not.toContain(password);
    }
    expect(await rowCount("inventory_items", productItem)).toBe(0);
    expect(
      (
        await db.execute(
          sql`SELECT 1 FROM nova.accounts WHERE user_id=${user.id}`,
        )
      ).rows,
    ).toHaveLength(0);
  });

test("only admins/owners delete, including rejection of a forged service role", async () => {
  const supplier = await saveMaster(db, admin, "suppliers", {
    name: "Protected access",
    state: "Tamil Nadu",
    address: "Fictional",
  });
  for (const actor of [
    null,
    { id: "demo-salesman-a", role: "salesman" },
    { id: "demo-production", role: "production" },
    { id: "demo-auditor", role: "auditor" },
    { id: "demo-salesman-a", role: "owner" },
  ] as (Actor | null)[])
    await expect(
      deleteRecord(db, actor, "suppliers", supplier.id),
    ).rejects.toBeInstanceOf(AccessError);
  expect(await rowCount("suppliers", supplier.id)).toBe(1);
});

test("deleted seed users/prices stay deleted and a former admin cannot manage users", async () => {
  await deleteRecord(db, admin, "users", "demo-auditor");
  await deleteRecord(db, owner, "prices", "demo-price");
  await seedDemo(db, password);
  expect(await rowCount("users", "demo-auditor")).toBe(0);
  expect(await rowCount("product_prices", "demo-price")).toBe(0);
  const email = randomUUID() + "@example.test";
  const second = await saveMaster(db, admin, "users", {
    name: "Second admin",
    email,
    role: "admin",
    password,
  });
  await saveMaster(
    db,
    admin,
    "users",
    { name: "Former admin", email, role: "owner", password: "" },
    second.id,
  );
  await expect(
    saveMaster(
      db,
      { id: second.id, role: "admin" },
      "users",
      {
        name: "Factory Admin",
        email: "admin@example.test",
        role: "owner",
        password: "",
      },
      admin.id,
    ),
  ).rejects.toThrow(/Administrator/);
  expect(
    (
      await db.execute(
        sql`SELECT role FROM nova.user_roles WHERE user_id=${admin.id}`,
      )
    ).rows[0].role,
  ).toBe("admin");
});

test("self deletion, last administrator and referenced history are protected atomically", async () => {
  await expect(deleteRecord(db, admin, "users", admin.id)).rejects.toThrow(
    /own account/,
  );
  await expect(deleteRecord(db, owner, "users", admin.id)).rejects.toThrow(
    /last administrator/,
  );
  for (const [resource, id] of [
    ["materials", "demo-flour"],
    ["products", "demo-murukku"],
    ["customers", "demo-retailer-a"],
    ["territories", "demo-territory-a"],
    ["users", "demo-salesman-a"],
  ]) {
    if (resource === "customers")
      await submitOrder(
        db,
        { id: "demo-salesman-a", role: "salesman" },
        order(),
      );
    await expect(deleteRecord(db, owner, resource, id)).rejects.toThrow(
      /referenced/,
    );
  }
  expect(
    (
      await db.execute(
        sql`SELECT role FROM nova.user_roles WHERE user_id='demo-admin'`,
      )
    ).rows[0].role,
  ).toBe("admin");
  expect(
    (await db.execute(sql`SELECT 1 FROM nova.deleted_records`)).rows,
  ).toHaveLength(0);
});

test("deleting opening/purchase/adjustment drafts retains audit and blocks stale request replay", async () => {
  for (const category of ["opening", "purchase", "adjustment"]) {
    const data = {
      ...input(),
      category,
      supplierId: category === "purchase" ? "demo-flour-supplier" : null,
      lines: [
        {
          itemId: "demo-flour",
          quantity: category === "adjustment" ? "-1" : "1",
          unit: "kg",
          unitRate: category === "adjustment" ? null : "45",
        },
      ],
    };
    const id = await createDocument(db, admin, data);
    await deleteRecord(db, owner, "stock", id);
    expect(await rowCount("stock_documents", id)).toBe(0);
    expect(
      (
        await db.execute(
          sql`SELECT 1 FROM nova.stock_document_lines WHERE document_id=${id}`,
        )
      ).rows,
    ).toHaveLength(0);
    await expect(createDocument(db, admin, data)).rejects.toThrow(
      /deleted record/,
    );
  }
});

test("unposted production can be deleted, while overhead-bearing runs remain", async () => {
  const data = benchmarkProduction(randomUUID());
  const id = await createRun(db, admin, data);
  await deleteRecord(db, owner, "production", id);
  expect(await rowCount("production_runs", id)).toBe(0);
  await expect(createRun(db, admin, data)).rejects.toThrow(/deleted record/);
  const held = await createRun(db, admin, benchmarkProduction(randomUUID()));
  await addOverhead(db, admin, held, {
    category: "labour",
    amount: "100",
    reason: "Recorded test overhead",
    requestKey: randomUUID(),
  });
  await expect(deleteRecord(db, admin, "production", held)).rejects.toThrow(
    /overheads/,
  );
  expect(await rowCount("production_runs", held)).toBe(1);
});

test("submitted orders delete without stock deduction, reviewed orders stay frozen", async () => {
  const a = { id: "demo-salesman-a", role: "salesman" } as const,
    data = order();
  const id = await submitOrder(db, a, data);
  await deleteRecord(db, owner, "orders", id);
  await expect(submitOrder(db, a, data)).rejects.toThrow(/deleted record/);
  const reviewed = await submitOrder(db, a, order());
  await reviewOrder(db, admin, reviewed, {
    decision: "approve",
    reason: "Stock checked",
  });
  await expect(deleteRecord(db, owner, "orders", reviewed)).rejects.toThrow(
    /Reviewed/,
  );
  expect(
    String(
      (
        await db.execute(
          sql`SELECT quantity FROM nova.stock_summary WHERE id='demo-finished'`,
        )
      ).rows[0].quantity,
    ),
  ).toMatch(/^50(?:\.0+)?$/);
});

test("posted stock, production, invoices, payments, BOMs and audit remain immutable", async () => {
  process.env.NOVA_ALLOW_DEMO_INVOICES = "true";
  await productionFixture(db);
  await salesFixture(db);
  const doc = (
    await db.execute(
      sql`SELECT id FROM nova.stock_documents WHERE category='opening'`,
    )
  ).rows[0].id as string;
  const prod = (await db.execute(sql`SELECT id FROM nova.production_runs`))
    .rows[0].id as string;
  for (const [resource, id] of [
    ["stock", doc],
    ["production", prod],
    ["invoices", "x"],
    ["payments", "x"],
    ["boms", "demo-bom-1"],
    ["ledger", "x"],
    ["credits", "x"],
    ["overheads", "x"],
    ["audit", "x"],
  ])
    await expect(deleteRecord(db, owner, resource, id)).rejects.toThrow();
  await expect(
    db.execute(sql`DELETE FROM nova.stock_documents WHERE id=${doc}`),
  ).rejects.toThrow();
  expect(
    String(
      (await db.execute(sql`SELECT outstanding FROM nova.invoice_balances`))
        .rows[0].outstanding,
    ),
  ).toBe("3875.00");
});

test("parallel duplicate deletion produces one tombstone and audit event", async () => {
  const id = await createDocument(db, admin, input());
  const result = await Promise.all([
    deleteRecord(db, admin, "stock", id),
    deleteRecord(db, owner, "stock", id),
  ]);
  expect(result.filter((r) => r.alreadyDeleted)).toHaveLength(1);
  expect(
    (
      await db.execute(
        sql`SELECT 1 FROM nova.audit_events WHERE document_id=${id} AND action='stock.delete'`,
      )
    ).rows,
  ).toHaveLength(1);
  await expect(
    db.execute(
      sql`UPDATE nova.deleted_records SET deleted_at=now() WHERE record_id=${id}`,
    ),
  ).rejects.toThrow();
});

test("posting competing with deletion never creates orphan movements or partial posting", async () => {
  const id = await createDocument(db, admin, input());
  const result = await Promise.allSettled([
    postDocument(db, admin, id),
    deleteRecord(db, owner, "stock", id),
  ]);
  expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const docs = (
    await db.execute(
      sql`SELECT status FROM nova.stock_documents WHERE id=${id}`,
    )
  ).rows;
  const movements = (
    await db.execute(
      sql`SELECT 1 FROM nova.inventory_movements WHERE document_id=${id}`,
    )
  ).rows;
  if (docs.length) {
    expect(docs[0].status).toBe("posted");
    expect(movements).toHaveLength(1);
  } else expect(movements).toHaveLength(0);
});

test("extra catalogue is idempotent, has no invented prices/recipes and respects deleted products", async () => {
  await seedDemoCatalog(db);
  await seedDemoCatalog(db);
  expect(
    (await db.execute(sql`SELECT 1 FROM nova.products`)).rows,
  ).toHaveLength(5);
  expect(
    (await db.execute(sql`SELECT 1 FROM nova.product_prices`)).rows,
  ).toHaveLength(1);
  expect(
    (await db.execute(sql`SELECT 1 FROM nova.bom_versions`)).rows,
  ).toHaveLength(1);
  await deleteRecord(db, owner, "products", "demo-mixture");
  await seedDemoCatalog(db);
  expect(await rowCount("products", "demo-mixture")).toBe(0);
});
