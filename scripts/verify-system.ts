import "dotenv/config";
import type { Pool } from "pg";
import { createDatabasePool } from "../src/lib/db/pool";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import * as schema from "../src/lib/db/schema";
import { seedDemo } from "./seed-data";
import { inventoryFixture } from "./inventory-fixture";
import { productionFixture } from "./production-fixture";
import { salesFixture } from "./sales-fixture";
import { getReport, businessToday } from "../src/modules/reporting/service";
import { kinds, type Filters } from "../src/modules/reporting/types";
import { reportCsv, reportPdf } from "../src/modules/reporting/exports";
import { Money as D } from "../src/modules/billing/tax";
const base = process.env.TEST_DATABASE_URL;
if (
  !base ||
  base === process.env.DATABASE_URL ||
  !new URL(base).pathname.endsWith("_test")
)
  throw new Error(
    "Provide an isolated TEST_DATABASE_URL with permission to create disposable test databases.",
  );
const databaseName =
  "nova_review_" + randomUUID().replaceAll("-", "") + "_test";
const adminPool = createDatabasePool(base);
const url = new URL(base);
url.pathname = "/" + databaseName;
let pool: Pool | undefined;
let created = false;
try {
  await adminPool.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  console.log(`Fresh review database: ${databaseName}`);
  pool = createDatabasePool(url.toString());
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  await migrate(db, { migrationsFolder: "drizzle" });
  process.env.NOVA_ALLOW_DEMO_INVOICES = "true";
  await seedDemo(db, process.env.DEMO_PASSWORD ?? randomUUID());
  await inventoryFixture(db);
  await productionFixture(db);
  await salesFixture(db);
  await salesFixture(db);
  const actor = { id: "demo-owner", role: "owner" } as const,
    today = await businessToday(db);
  const f: Filters = {
    from: "2026-01-01",
    to: today,
    asOf: today,
    scope: "demo",
    customer: "",
    product: "",
    salesman: "",
    item: "",
    status: "all",
  };
  const reports = await Promise.all(
    kinds.map((k) => getReport(db, actor, k, f)),
  );
  const find = (kind: string) => reports.find((r) => r.kind === kind)!;
  for (const [field, value] of Object.entries({
    taxable: "7500",
    cgst: "187.5",
    sgst: "187.5",
    total: "7875",
  }))
    assert(new D(find("sales").totals[field]!).eq(value));
  assert(new D(find("payments").totals.amount!).eq(4000));
  assert(new D(find("receivables").totals.outstanding!).eq(3875));
  for (const [id, value] of Object.entries({
    "demo-flour": "120000",
    "demo-oil": "19500",
    "demo-spice": "3800",
    "demo-pouch": "306",
    "demo-carton": "21",
    "demo-finished": "88",
  }))
    assert(
      new D(find("stock").rows.find((r) => r.item_id === id)!.closing!).eq(
        value,
      ),
    );
  assert.equal(
    find("stock").rows.find((r) => r.item_id === "demo-finished")!.value,
    null,
  );
  assert(new D(find("purchases").totals.amount!).eq(2700));
  assert(new D(find("production").rows[0].total_cost!).eq(5855));
  assert.equal(
    new D(find("production").rows[0].cost_per_packet!).toFixed(2),
    "31.14",
  );
  for (const r of reports) {
    assert(reportCsv(r).length > 0);
    assert(reportPdf(r).subarray(0, 8).toString().startsWith("%PDF"));
  }
  console.log(
    "Fresh benchmark and all monthly reports/exports reconciled: stock 88; invoice 7875; payment 4000; outstanding 3875; production cost 5855; packet 31.14.",
  );
  if (process.argv.includes("--measure")) {
    const count = 4999;
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`INSERT INTO nova.sales_orders(id,customer_id,salesman_id,request_key,payload) SELECT 'load-order-'||g,'demo-retailer-a','demo-salesman-a','load-key-'||g,'{}'::jsonb FROM generate_series(1,${count}) g`,
      );
      await tx.execute(
        sql`INSERT INTO nova.sales_order_lines(id,order_id,product_id,quantity,rate,gst_percent) SELECT 'load-line-'||g,'load-order-'||g,'demo-murukku',1,50,5 FROM generate_series(1,${count}) g`,
      );
      await tx.execute(
        sql`UPDATE nova.sales_orders SET status='approved' WHERE id LIKE 'load-order-%'`,
      );
      await tx.execute(
        sql`INSERT INTO nova.invoices(id,order_id,number,financial_year,invoice_date,snapshot,total,created_by,issuance_mode) SELECT 'load-invoice-'||g,'load-order-'||g,'LOAD/2026-27/'||g,'2026-27','2026-11-17',jsonb_build_object('seller',i.snapshot->'seller','customer',i.snapshot->'customer','placeOfSupply','Tamil Nadu','lines',jsonb_build_array(jsonb_build_object('productId','demo-murukku','description','Synthetic load fixture','quantity','1','unit','packet','rate','50','gstPercent','5','hsn','1905','taxable','50.00','cgst','1.25','sgst','1.25','igst','0.00','total','52.50')),'total','52.50','mode','demo'),52.5,'demo-admin','demo' FROM generate_series(1,${count}) g CROSS JOIN (SELECT snapshot FROM nova.invoices LIMIT 1) i`,
      );
      await tx.execute(
        sql`UPDATE nova.sales_orders SET status='invoiced' WHERE id LIKE 'load-order-%'`,
      );
      await tx.execute(
        sql`INSERT INTO nova.payments(id,customer_id,payment_date,reference,method,amount,request_key,payload,actor_id) SELECT 'load-payment-'||g,'demo-retailer-a','2026-11-17','Synthetic load fixture','bank',10,'load-payment-key-'||g,'{}'::jsonb,'demo-admin' FROM generate_series(1,${count}) g`,
      );
      await tx.execute(
        sql`INSERT INTO nova.payment_allocations(payment_id,invoice_id,amount) SELECT 'load-payment-'||g,'load-invoice-'||g,10 FROM generate_series(1,${count}) g`,
      );
    });
    await db.execute(sql`ANALYZE nova.invoices`);
    await db.execute(sql`ANALYZE nova.payment_allocations`);
    const explain = async () => {
      const r = await pool!.query(
        `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT i.id,(SELECT sum(a.amount) FROM nova.payment_allocations a WHERE a.invoice_id=i.id) FROM nova.invoices i`,
      );
      return r.rows[0]["QUERY PLAN"][0]["Execution Time"];
    };
    await db.execute(sql`DROP INDEX IF EXISTS nova.payment_allocation_invoice`);
    const before = await explain();
    await db.execute(
      sql`CREATE INDEX payment_allocation_invoice ON nova.payment_allocations(invoice_id)`,
    );
    const after = await explain();
    const time = performance.now();
    const r = await getReport(db, actor, "receivables", f);
    const queryMs = performance.now() - time;
    const csvStart = performance.now(),
      csv = reportCsv(r),
      csvMs = performance.now() - csvStart;
    const pdfStart = performance.now(),
      pdf = reportPdf(r),
      pdfMs = performance.now() - pdfStart;
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`INSERT INTO nova.sales_orders(id,customer_id,salesman_id,request_key,payload) VALUES('load-limit-order','demo-retailer-a','demo-salesman-a','load-limit-key','{}'::jsonb)`,
      );
      await tx.execute(
        sql`INSERT INTO nova.sales_order_lines(id,order_id,product_id,quantity,rate,gst_percent) VALUES('load-limit-line','load-limit-order','demo-murukku',1,50,5)`,
      );
      await tx.execute(
        sql`UPDATE nova.sales_orders SET status='approved' WHERE id='load-limit-order'`,
      );
      await tx.execute(
        sql`INSERT INTO nova.invoices(id,order_id,number,financial_year,invoice_date,snapshot,total,created_by,issuance_mode) SELECT 'load-limit-invoice','load-limit-order','LOAD/LIMIT','2026-27','2026-11-17',snapshot,52.5,'demo-admin','demo' FROM nova.invoices WHERE id='load-invoice-1'`,
      );
    });
    await assert.rejects(getReport(db, actor, "receivables", f), /5,000 rows/);
    console.log("5,001-row report rejected without partial totals.");
    console.log(
      JSON.stringify({
        syntheticInvoices: count,
        allocationPlanBeforeMs: before,
        allocationPlanAfterMs: after,
        reportRows: r.rows.length,
        reportMs: queryMs.toFixed(1),
        csvMs: csvMs.toFixed(1),
        csvBytes: Buffer.byteLength(csv),
        pdfMs: pdfMs.toFixed(1),
        pdfBytes: pdf.length,
        heapMiB: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1),
      }),
    );
  }
} finally {
  await pool?.end();
  const remaining = await adminPool.query(
    "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1",
    [databaseName],
  );
  assert.equal(
    remaining.rows[0].n,
    0,
    "Review connections must close before the disposable database is dropped.",
  );
  if (!/^nova_review_[a-f0-9]{32}_test$/.test(databaseName))
    throw new Error("Unsafe review database identity");
  if (created)
    await adminPool.query(
      `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
    );
  await adminPool.end();
}
