import { beforeEach, afterAll, test, expect } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "../src/lib/db/schema";
import { seedDemo } from "../scripts/seed-data";
import { inventoryFixture } from "../scripts/inventory-fixture";
import {
  productionFixture,
  benchmarkProduction,
} from "../scripts/production-fixture";
import {
  createRun,
  postRun,
  addOverhead,
  listRuns,
} from "../src/modules/production/service";
import {
  ProductionDecimal as D,
  variance,
} from "../src/modules/production/calculations";
import { publishBom, getBom } from "../src/modules/catalog/bom";
import { scaleBom, convert } from "../src/lib/units/convert";
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  url === process.env.DATABASE_URL ||
  !new URL(url).pathname.endsWith("_test")
)
  throw new Error("Isolated test database required");
const pool = new Pool({ connectionString: url });
const db = drizzle(pool, { schema });
const actor = { id: "demo-production", role: "production" } as const;
beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE nova.users,nova.roles,nova.units,nova.inventory_items,nova.territories CASCADE`,
  );
  await seedDemo(db, process.env.DEMO_PASSWORD ?? randomUUID());
  await inventoryFixture(db);
}, 30000);
afterAll(() => pool.end());
test("benchmark stock, material snapshots, damage, variance and costing", async () => {
  const id = await productionFixture(db);
  const stock = (await db.execute(sql`SELECT * FROM nova.stock_summary`)).rows;
  for (const [item, expected] of Object.entries({
    "demo-flour": "120000",
    "demo-oil": "19500",
    "demo-spice": "3800",
    "demo-pouch": "306",
    "demo-carton": "21",
    "demo-finished": "238",
  }))
    expect(
      new D(String(stock.find((s) => s.id === item)?.quantity)).eq(expected),
    ).toBe(true);
  expect(stock.find((s) => s.id === "demo-finished")?.value).toBeNull();
  const run = (await listRuns(db, actor)).find((r) => r.id === id)!;
  expect(new D(String(run.material_cost)).eq("4055")).toBe(true);
  expect(new D(String(run.overheads)).eq("1800")).toBe(true);
  expect(new D(String(run.total_cost)).eq("5855")).toBe(true);
  expect(new D(String(run.cost_per_packet)).toFixed(2)).toBe("31.14");
  const snapshot = run.snapshot as {
    yield: { percent: string; flagged: boolean };
    lines: {
      itemId: string;
      percent: string;
      flagged: boolean;
      damaged: string;
    }[];
  };
  expect(snapshot.yield).toEqual({ percent: "-6", flagged: true });
  expect(snapshot.lines.find((l) => l.itemId === "demo-oil")).toMatchObject({
    percent: "5",
    flagged: true,
  });
  expect(snapshot.lines.find((l) => l.itemId === "demo-pouch")).toMatchObject({
    damaged: "6",
    percent: "-3",
    flagged: false,
  });
  const costs = run.material_costs as { itemId: string; cost: string }[];
  for (const [item, cost] of Object.entries({
    "demo-flour": "1725",
    "demo-oil": "1470",
    "demo-spice": "240",
    "demo-pouch": "485",
    "demo-carton": "135",
  }))
    expect(new D(costs.find((c) => c.itemId === item)!.cost).eq(cost)).toBe(
      true,
    );
  expect(
    (
      await db.execute(
        sql`SELECT * FROM nova.inventory_movements WHERE document_id=${id}`,
      )
    ).rows,
  ).toHaveLength(6);
});
test("drafts do not move stock; edits and repeated posting are controlled", async () => {
  const data = benchmarkProduction();
  const id = await createRun(db, actor, data);
  expect(await createRun(db, actor, data)).toBe(id);
  expect(
    (
      await db.execute(
        sql`SELECT * FROM nova.inventory_movements WHERE document_id=${id}`,
      )
    ).rows,
  ).toHaveLength(0);
  await createRun(db, actor, { ...data, goodOutput: "187" }, id);
  await createRun(db, actor, data, id);
  await Promise.all([postRun(db, actor, id), postRun(db, actor, id)]);
  expect(
    (
      await db.execute(
        sql`SELECT * FROM nova.inventory_movements WHERE document_id=${id}`,
      )
    ).rows,
  ).toHaveLength(6);
  await expect(createRun(db, actor, data, id)).rejects.toMatchObject({
    status: 409,
  });
  await expect(
    db.execute(
      sql`UPDATE nova.production_runs SET good_output=1 WHERE id=${id}`,
    ),
  ).rejects.toThrow();
  await expect(
    db.execute(
      sql`UPDATE nova.inventory_movements SET quantity=1 WHERE document_id=${id}`,
    ),
  ).rejects.toThrow();
});
test("overheads are idempotent, audited and leave material/ledger snapshots unchanged", async () => {
  const id = await createRun(db, actor, benchmarkProduction());
  await postRun(db, actor, id);
  const before = (
    await db.execute(
      sql`SELECT * FROM nova.inventory_movements WHERE document_id=${id} ORDER BY id`,
    )
  ).rows;
  const overhead = {
    category: "labour",
    amount: "1200",
    reason: "Labour fixture",
    requestKey: "test-labour-key",
  };
  await addOverhead(db, actor, id, overhead);
  await addOverhead(db, actor, id, overhead);
  await addOverhead(db, actor, id, {
    category: "gas_power",
    amount: "600",
    reason: "Gas fixture",
    requestKey: "test-gas-key",
  });
  expect(
    (
      await db.execute(
        sql`SELECT * FROM nova.inventory_movements WHERE document_id=${id} ORDER BY id`,
      )
    ).rows,
  ).toEqual(before);
  expect(
    (
      await db.execute(
        sql`SELECT * FROM nova.audit_events WHERE document_id=${id} AND action='production.overhead'`,
      )
    ).rows,
  ).toHaveLength(2);
  await productionFixture(db);
  expect(
    new D(String((await listRuns(db, actor))[0].material_cost)).eq("4055"),
  ).toBe(true);
});
test("insufficient material rolls back every issue, output and cost snapshot", async () => {
  const data = benchmarkProduction();
  data.inputs.find((i) => i.itemId === "demo-spice")!.actual = "99";
  const id = await createRun(db, actor, data);
  await expect(postRun(db, actor, id)).rejects.toThrow();
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
        sql`SELECT * FROM nova.production_cost_snapshots WHERE run_id=${id}`,
      )
    ).rows,
  ).toHaveLength(0);
  expect((await listRuns(db, actor))[0].status).toBe("draft");
});
test("concurrent production competes safely for available materials", async () => {
  await productionFixture(db);
  const a = await createRun(db, actor, benchmarkProduction(randomUUID()));
  const b = await createRun(db, actor, benchmarkProduction(randomUUID()));
  const results = await Promise.allSettled([
    postRun(db, actor, a),
    postRun(db, actor, b),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const stock = (await db.execute(sql`SELECT quantity FROM nova.stock_summary`))
    .rows;
  expect(stock.every((r) => new D(String(r.quantity)).gte(0))).toBe(true);
});
test("BOM snapshots survive later revisions; scaling and units remain exact", async () => {
  const input = benchmarkProduction();
  input.batches = "2";
  const id = await createRun(db, actor, input);
  const before = (await listRuns(db, actor))[0].snapshot;
  const bom = await getBom(db, actor, "demo-bom-1");
  await publishBom(db, actor, {
    productId: bom.productId,
    batchSize: "1",
    expectedOutput: "210",
    outputUnit: "packet",
    lines: bom.lines.map((l) => ({
      itemId: l.itemId,
      quantity: l.quantity,
      unit: l.unit,
    })),
  });
  expect(
    (await listRuns(db, actor)).find((r) => r.id === id)?.snapshot,
  ).toEqual(before);
  expect(before).toMatchObject({
    expectedOutput: "400",
    lines: expect.arrayContaining([
      expect.objectContaining({ itemId: "demo-flour", planned: "80" }),
    ]),
  });
  expect(convert("1.2", "kg", "g")).toBe("1200");
  expect(scaleBom("40", "1", "2")).toBe("80");
  const bad = benchmarkProduction(randomUUID());
  bad.inputs[0].unit = "L";
  await expect(createRun(db, actor, bad)).rejects.toThrow();
});
test("variance boundaries use unrounded comparison and zero expected is safe", () => {
  expect(variance("103", "100", "3")).toEqual({ percent: "3", flagged: false });
  expect(variance("103.000001", "100", "3").flagged).toBe(true);
  expect(variance("96.999999", "100", "3").flagged).toBe(true);
  expect(variance("0", "0", "3")).toEqual({ percent: null, flagged: false });
  expect(variance("1", "0", "3")).toEqual({ percent: null, flagged: true });
});
test("unauthorized posting, invalid wastage and invalid yield fail", async () => {
  const id = await createRun(db, actor, benchmarkProduction());
  await expect(
    postRun(db, { id: "demo-auditor", role: "auditor" }, id),
  ).rejects.toMatchObject({ status: 403 });
  await expect(listRuns(db, null)).rejects.toMatchObject({ status: 401 });
  await expect(
    listRuns(db, { id: "demo-salesman-a", role: "salesman" }),
  ).rejects.toMatchObject({ status: 403 });
  const bad = benchmarkProduction(randomUUID());
  bad.inputs[3].damaged = "195";
  await expect(createRun(db, actor, bad)).rejects.toThrow();
  await expect(
    createRun(db, actor, {
      ...benchmarkProduction(randomUUID()),
      goodOutput: "0",
    }),
  ).rejects.toThrow();
});
