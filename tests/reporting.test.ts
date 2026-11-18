import { beforeEach, afterAll, test, expect } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "../src/lib/db/schema";
import { seedDemo } from "../scripts/seed-data";
import { inventoryFixture } from "../scripts/inventory-fixture";
import { productionFixture } from "../scripts/production-fixture";
import { salesFixture, exerciseInvoice } from "../scripts/sales-fixture";
import {
  getReport,
  businessToday,
  reportInTransaction,
} from "../src/modules/reporting/service";
import { getDashboard } from "../src/modules/reporting/dashboard";
import {
  reportCsv,
  reportPdf,
  displayCell,
} from "../src/modules/reporting/exports";
import { kinds, type Filters } from "../src/modules/reporting/types";
import { Money as D } from "../src/modules/billing/tax";
import {
  submitOrder,
  reviewOrder,
  issueDemoInvoice,
  creditInvoice,
} from "../src/modules/sales/service";
import { addOverhead } from "../src/modules/production/service";
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  url === process.env.DATABASE_URL ||
  !new URL(url).pathname.endsWith("_test")
)
  throw new Error("Isolated test database required");
const pool = new Pool({ connectionString: url });
const db = drizzle(pool, { schema });
const admin = { id: "demo-admin", role: "admin" } as const,
  owner = { id: "demo-owner", role: "owner" } as const,
  auditor = { id: "demo-auditor", role: "auditor" } as const,
  production = { id: "demo-production", role: "production" } as const,
  a = { id: "demo-salesman-a", role: "salesman" } as const,
  b = { id: "demo-salesman-b", role: "salesman" } as const;
const currentBusinessDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const reportEnd =
  currentBusinessDate > "2026-11-30" ? currentBusinessDate : "2026-11-30";
const f: Filters = {
  from: "2026-11-01",
  to: reportEnd,
  asOf: reportEnd,
  scope: "demo",
  customer: "",
  product: "",
  salesman: "",
  item: "",
  status: "all",
};
const money = (value: string | null, expected: string) =>
  expect(new D(value ?? "NaN").eq(expected)).toBe(true);
function dayOffset(day: string, offset: number) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
beforeEach(async () => {
  process.env.NOVA_ALLOW_DEMO_INVOICES = "true";
  await db.execute(
    sql`TRUNCATE nova.users,nova.roles,nova.units,nova.inventory_items,nova.territories CASCADE`,
  );
  await seedDemo(db, process.env.DEMO_PASSWORD ?? randomUUID());
  await inventoryFixture(db);
  await productionFixture(db);
  await salesFixture(db);
}, 30000);
afterAll(() => pool.end());
test("all Stage 5 benchmark reports reconcile without counting the unfulfilled order", async () => {
  const sales = await getReport(db, auditor, "sales", f);
  expect(sales.rows).toHaveLength(1);
  expect(sales.rows[0].customer).toBe("Retailer A");
  money(sales.totals.quantity, "150");
  for (const [field, value] of Object.entries({
    taxable: "7500",
    cgst: "187.5",
    sgst: "187.5",
    igst: "0",
    total: "7875",
  }))
    money(sales.totals[field], value);
  const gst = await getReport(db, auditor, "gst", f);
  expect(gst.rows).toHaveLength(1);
  expect(gst.rows[0]).toMatchObject({
    treatment: "Intrastate",
    event: "Invoice",
  });
  money(gst.totals.total, "7875");
  for (const kind of ["customer_sales", "product_sales"] as const) {
    const r = await getReport(db, auditor, kind, f);
    expect(r.rows).toHaveLength(1);
    money(r.totals.total, "7875");
    money(r.totals.quantity, "150");
  }
  const purchases = await getReport(db, auditor, "purchases", f);
  expect(purchases.rows).toHaveLength(1);
  expect(purchases.rows[0]).toMatchObject({ unit: "kg", status: "posted" });
  money(purchases.rows[0].quantity, "60");
  money(purchases.rows[0].unit_rate, "45");
  money(purchases.totals.amount, "2700");
  const runs = await getReport(db, auditor, "production", f);
  expect(runs.rows).toHaveLength(1);
  money(runs.rows[0].expected, "200");
  money(runs.rows[0].good, "188");
  money(runs.rows[0].yield_variance, "-6");
  expect(runs.rows[0].alert).toBe("true");
  money(runs.rows[0].material_cost, "4055");
  money(runs.rows[0].labour, "1200");
  money(runs.rows[0].utilities, "600");
  money(runs.rows[0].total_cost, "5855");
  expect(
    displayCell(runs.rows[0].cost_per_packet, {
      key: "cost",
      label: "INR",
      type: "money",
    }),
  ).toBe("31.14");
  const consumption = await getReport(db, auditor, "consumption", f);
  expect(consumption.rows).toHaveLength(5);
  const oil = consumption.rows.find((r) => r.item === "Cooking oil")!;
  money(oil.variance, "5");
  expect(oil.alert).toBe("true");
  money(consumption.rows.find((r) => r.item === "200 g pouches")!.waste, "6");
  money(consumption.totals.cost, "4055");
  const payments = await getReport(db, auditor, "payments", f);
  expect(payments.rows).toHaveLength(1);
  money(payments.totals.amount, "4000");
  const balances = await getReport(db, auditor, "receivables", f);
  expect(balances.rows).toHaveLength(1);
  money(balances.totals.collected, "4000");
  money(balances.totals.outstanding, "3875");
  const customers = await getReport(db, auditor, "customer_balances", f);
  money(customers.totals.outstanding, "3875");
  const ageing = await getReport(db, auditor, "ageing", f);
  money(ageing.totals.age_0_30, "3875");
  money(ageing.totals.outstanding, "3875");
});
test("stock rollforward, historical balances and source-linked ledger reconcile exactly", async () => {
  const stock = await getReport(db, owner, "stock", f);
  const expected = {
    "demo-flour": "120000",
    "demo-oil": "19500",
    "demo-spice": "3800",
    "demo-pouch": "306",
    "demo-carton": "21",
    "demo-finished": "88",
  };
  for (const row of stock.rows) {
    money(row.closing, expected[row.item_id as keyof typeof expected]);
    money(
      new D(row.opening!)
        .plus(row.receipts!)
        .minus(row.issues!)
        .plus(row.adjustments!)
        .toFixed(),
      row.closing!,
    );
  }
  const finished = stock.rows.find((r) => r.item_id === "demo-finished")!;
  expect(finished.value).toBeNull();
  expect(finished.valuation).toMatch(/Unknown/);
  const today = await businessToday(db),
    previous = dayOffset(today, -1),
    next = dayOffset(today, 1);
  const before = await getReport(db, owner, "stock", {
    ...f,
    from: previous,
    to: previous,
    asOf: previous,
  });
  expect(before.rows.every((r) => new D(r.closing!).eq(0))).toBe(true);
  const nextStock = await getReport(db, owner, "stock", {
    ...f,
    from: next,
    to: next,
    asOf: next,
  });
  const nextFinished = nextStock.rows.find(
    (r) => r.item_id === "demo-finished",
  )!;
  money(nextFinished.opening, "88");
  money(nextFinished.receipts, "0");
  money(nextFinished.issues, "0");
  money(nextFinished.closing, "88");
  const ledger = await getReport(db, owner, "ledger", f);
  const issues = ledger.rows.filter((r) => r.category === "dispatch");
  expect(issues).toHaveLength(1);
  money(issues[0].quantity, "-150");
  expect(issues[0].value).toBeNull();
  expect(issues[0].source_id).toBeTruthy();
  expect(issues[0].document_id).toBeTruthy();
  expect(issues[0].actor).toBe("Factory Admin");
  const sum = ledger.rows
    .filter((r) => r.item === "Murukku 200 g")
    .reduce((v, r) => v.plus(r.quantity!), new D(0));
  money(sum.toFixed(), "88");
  const current = (
    await db.execute(
      sql`SELECT quantity,value FROM nova.stock_summary WHERE id='demo-finished'`,
    )
  ).rows[0];
  money(finished.closing, String(current.quantity));
  expect(current.value).toBeNull();
});
test("date endpoints, filters and explicit demo separation are enforced", async () => {
  expect(
    (await getReport(db, owner, "sales", { ...f, scope: "real" })).rows,
  ).toHaveLength(0);
  expect(
    (await getReport(db, owner, "gst", { ...f, scope: "real" })).totals.total,
  ).toBe("0.00");
  expect(
    (
      await getReport(db, owner, "sales", {
        ...f,
        from: "2026-11-17",
        to: "2026-11-17",
        asOf: "2026-11-17",
      })
    ).rows,
  ).toHaveLength(1);
  expect(
    (await getReport(db, owner, "sales", { ...f, from: "2026-11-18" })).rows,
  ).toHaveLength(0);
  expect(
    (
      await getReport(db, owner, "sales", {
        ...f,
        customer: "demo-distributor-b",
      })
    ).rows,
  ).toHaveLength(0);
  expect(
    (await getReport(db, owner, "sales", { ...f, product: "absent" })).rows,
  ).toHaveLength(0);
  expect(
    (await getReport(db, owner, "sales", { ...f, salesman: b.id })).rows,
  ).toHaveLength(0);
  await expect(
    getReport(db, owner, "sales", { ...f, to: "2026-10-01" }),
  ).rejects.toThrow();
  const today = await businessToday(db),
    previous = dayOffset(today, -1);
  const todayLedger = await getReport(db, owner, "ledger", {
    ...f,
    from: today,
    to: today,
    asOf: today,
  });
  expect(todayLedger.rows.length).toBeGreaterThan(0);
  const yesterdayLedger = await getReport(db, owner, "ledger", {
    ...f,
    from: previous,
    to: previous,
    asOf: previous,
  });
  expect(yesterdayLedger.rows).toHaveLength(0);
});
test("report and dashboard permissions restrict roles and salesman customer attribution", async () => {
  await expect(getReport(db, null, "sales", f)).rejects.toThrow(/sign in/);
  for (const kind of [
    "gst",
    "purchases",
    "payments",
    "stock",
    "production",
  ] as const)
    await expect(getReport(db, a, kind, f)).rejects.toThrow(/permitted/);
  for (const kind of ["sales", "gst", "payments", "receivables"] as const)
    await expect(getReport(db, production, kind, f)).rejects.toThrow(
      /permitted/,
    );
  expect((await getReport(db, a, "sales", f)).rows).toHaveLength(1);
  expect((await getReport(db, b, "sales", f)).rows).toHaveLength(0);
  await expect(
    getReport(db, a, "sales", { ...f, customer: "demo-distributor-b" }),
  ).rejects.toThrow(/territory/);
  await expect(
    getReport(db, a, "sales", { ...f, salesman: b.id }),
  ).rejects.toThrow(/scope/);
  await expect(getDashboard(db, a, "demo")).rejects.toThrow(/permitted/);
  await expect(getDashboard(db, production, "demo")).rejects.toThrow(
    /permitted/,
  );
  for (const kind of kinds)
    expect((await getReport(db, auditor, kind, f)).kind).toBe(kind);
});
test("overhead additions are visible in fresh reports, not a repeatable-read snapshot or ledger", async () => {
  const run = (await getReport(db, owner, "production", f)).rows[0];
  const ledgerBefore = (
    await db.execute(sql`SELECT * FROM nova.inventory_movements ORDER BY id`)
  ).rows;
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`,
    );
    const before = await reportInTransaction(tx, owner, "production", f);
    await addOverhead(db, production, run.run_id!, {
      category: "other",
      amount: "100",
      reason: "Late report cost",
      requestKey: randomUUID(),
    });
    const after = await reportInTransaction(tx, owner, "production", f);
    expect(after.rows).toEqual(before.rows);
  });
  const fresh = await getReport(db, owner, "production", f);
  money(fresh.rows[0].total_cost, "5955");
  money(fresh.rows[0].material_cost, "4055");
  expect(
    (await db.execute(sql`SELECT * FROM nova.inventory_movements ORDER BY id`))
      .rows,
  ).toEqual(ledgerBefore);
});
test("ageing uses invoice age and actual as-of allocations without invented due dates", async () => {
  const start = await getReport(db, owner, "receivables", {
    ...f,
    to: "2026-11-16",
    asOf: "2026-11-16",
  });
  expect(start.rows).toHaveLength(0);
  for (const [asOf, key] of [
    ["2026-12-18", "age_31_60"],
    ["2027-01-18", "age_61_90"],
    ["2027-02-18", "age_91_plus"],
  ] as const) {
    const r = await getReport(db, owner, "ageing", { ...f, asOf });
    money(r.totals[key], "3875");
    money(r.totals.outstanding, "3875");
  }
  const report = await getReport(db, owner, "receivables", f);
  expect(report.notes.join(" ")).toContain("not overdue");
});
test("full credits have their own signed GST events and cannot inflate collections", async () => {
  const id = await submitOrder(db, a, {
    customerId: "demo-retailer-a",
    requestKey: randomUUID(),
    lines: [{ productId: "demo-murukku", quantity: "10", rate: "50.00" }],
  });
  await reviewOrder(db, admin, id, {
    decision: "approve",
    reason: "Credit reporting fixture",
  });
  const invoice = await issueDemoInvoice(db, admin, id, exerciseInvoice);
  await creditInvoice(db, admin, invoice, "Full reporting credit");
  const gst = await getReport(db, owner, "gst", f);
  expect(gst.rows.some((r) => r.event === "Full credit")).toBe(true);
  money(gst.totals.total, "7875");
  const balances = await getReport(db, owner, "customer_balances", f);
  money(balances.totals.collected, "4000");
  money(balances.totals.credited, "525");
  money(balances.totals.outstanding, "3875");
  const credited = await getReport(db, owner, "sales", {
    ...f,
    status: "credited",
  });
  expect(credited.rows).toHaveLength(1);
  money(credited.totals.total, "525");
});
test("CSV escaping, exact totals, empty export and PDF use the displayed result", async () => {
  const report = await getReport(db, owner, "sales", f);
  const csv = reportCsv(report);
  expect(csv).toContain('"Taxable (INR)"');
  expect(csv).toContain('"7875.00"');
  expect(csv).toContain('"2026-11-01"');
  expect(csv).toContain('"totals"');
  const injected = {
    ...report,
    rows: [{ ...report.rows[0], customer: ' =HYPERLINK("malicious")\nquoted' }],
  };
  expect(reportCsv(injected)).toContain(
    '"\' =HYPERLINK(""malicious"")\nquoted"',
  );
  const pdf = reportPdf(report).toString("latin1");
  expect(pdf).toContain("%PDF-1.4");
  expect(pdf).toContain("DEMONSTRATION ONLY");
  expect(pdf).toContain("7875.00");
  const empty = await getReport(db, owner, "sales", { ...f, scope: "real" });
  expect(reportCsv(empty)).toContain('"empty"');
  expect(reportPdf(empty).toString()).toContain("No records");
});
test("dashboard metrics match their underlying source reports", async () => {
  const dashboard = await getDashboard(db, owner, "demo");
  money(
    dashboard.sales.totals.total,
    dashboard.today.startsWith("2026-11") ? "7875" : "0",
  );
  money(dashboard.receivables.totals.outstanding, "3875");
  expect(dashboard.pendingApprovals).toBe(1);
  expect(dashboard.submittedToday).toBe(2);
  expect(
    dashboard.production.rows.filter((r) => r.alert === "true"),
  ).toHaveLength(1);
  money(dashboard.production.rows[0].total_cost, "5855");
  money(
    dashboard.stock.rows.find((r) => r.item_id === "demo-finished")!.closing,
    "88",
  );
  const real = await getDashboard(db, owner, "real");
  money(real.sales.totals.total, "0");
  money(real.receivables.totals.outstanding, "0");
});
import { saveMaster } from "../src/modules/catalog/service";
import { createDocument, postDocument } from "../src/modules/inventory/service";
import { saveProfile } from "../src/modules/billing/profile";
import { exerciseProfile } from "../scripts/sales-fixture";
import { issueInvoice } from "../src/modules/sales/service";
import { recordPayment } from "../src/modules/payments/service";
test("multi-line invoices and product filters never repeat header totals or collections", async () => {
  const product = await saveMaster(db, admin, "products", {
    name: "Reporting test snack",
    packGrams: "100",
    cartonCapacity: 10,
  });
  await saveMaster(db, admin, "prices", {
    productId: product.id,
    amount: "10",
    gstPercent: "5",
  });
  const item = (
    await db.execute(
      sql`SELECT item_id FROM nova.products WHERE id=${product.id}`,
    )
  ).rows[0];
  const opening = await createDocument(db, admin, {
    category: "opening",
    supplierId: null,
    reason: "Reporting fixture opening",
    requestKey: randomUUID(),
    lines: [
      { itemId: item.item_id, quantity: "20", unit: "packet", unitRate: null },
    ],
  });
  await postDocument(db, admin, opening);
  await saveProfile(db, admin, {
    ...exerciseProfile,
    products: [
      ...exerciseProfile.products,
      { productId: product.id, hsn: "1905" },
    ],
  });
  const order = await submitOrder(db, a, {
    customerId: "demo-retailer-a",
    requestKey: randomUUID(),
    lines: [
      { productId: "demo-murukku", quantity: "10", rate: "50" },
      { productId: product.id, quantity: "20", rate: "10" },
    ],
  });
  await reviewOrder(db, admin, order, {
    decision: "approve",
    reason: "Multiple line report fixture",
  });
  const invoice = await issueDemoInvoice(db, admin, order, exerciseInvoice);
  await recordPayment(db, admin, {
    customerId: "demo-retailer-a",
    date: "2026-11-17",
    reference: "Multi-line collection",
    method: "cash",
    amount: "100",
    requestKey: randomUUID(),
    allocations: [{ invoiceId: invoice, amount: "100" }],
  });
  const sales = await getReport(db, owner, "sales", f);
  expect(sales.rows).toHaveLength(2);
  money(sales.totals.total, "8610");
  const selected = await getReport(db, owner, "sales", {
    ...f,
    product: product.id,
  });
  expect(selected.rows).toHaveLength(1);
  money(selected.totals.total, "210");
  money(selected.rows[0].invoice_total, "735");
  const payments = await getReport(db, owner, "payments", f);
  money(payments.totals.amount, "4100");
  const selectedPayments = await getReport(db, owner, "payments", {
    ...f,
    product: product.id,
  });
  money(selectedPayments.totals.amount, "100");
  const receivables = await getReport(db, owner, "receivables", {
    ...f,
    product: product.id,
  });
  money(receivables.totals.outstanding, "635");
});
test("mixed real/demo allocations are partitioned by invoice scope without double-counting payments", async () => {
  await saveProfile(db, admin, {
    ...exerciseProfile,
    mode: "real",
    name: "Synthetic reporting validation only",
    gstin: "33ABCDE1234F1Z7",
  });
  const id = await submitOrder(db, a, {
    customerId: "demo-retailer-a",
    requestKey: randomUUID(),
    lines: [{ productId: "demo-murukku", quantity: "1", rate: "50" }],
  });
  await reviewOrder(db, admin, id, {
    decision: "approve",
    reason: "Synthetic real-scope report fixture",
  });
  const real = await issueInvoice(db, admin, id, exerciseInvoice);
  const sample = (
    await db.execute(
      sql`SELECT id FROM nova.invoices WHERE issuance_mode='demo'`,
    )
  ).rows[0];
  await recordPayment(db, admin, {
    customerId: "demo-retailer-a",
    date: "2026-11-17",
    reference: "Mixed scope collection",
    method: "bank",
    amount: "100",
    requestKey: randomUUID(),
    allocations: [
      { invoiceId: String(sample.id), amount: "50" },
      { invoiceId: real, amount: "50" },
    ],
  });
  money((await getReport(db, owner, "payments", f)).totals.amount, "4050");
  money(
    (await getReport(db, owner, "payments", { ...f, scope: "real" })).totals
      .amount,
    "50",
  );
  const actual = (
    await db.execute(sql`SELECT sum(amount)::text AS amount FROM nova.payments`)
  ).rows[0];
  money(String(actual.amount), "4100");
  const realSales = await getReport(db, owner, "sales", {
    ...f,
    scope: "real",
  });
  expect(realSales.rows).toHaveLength(1);
  money(realSales.totals.total, "52.5");
  money((await getReport(db, owner, "sales", f)).totals.total, "7875");
});
test("as-of collections and overhead cutoffs exclude later dated source events", async () => {
  const id = await submitOrder(db, a, {
    customerId: "demo-retailer-a",
    requestKey: randomUUID(),
    lines: [{ productId: "demo-murukku", quantity: "1", rate: "50" }],
  });
  await reviewOrder(db, admin, id, {
    decision: "approve",
    reason: "As-of report fixture",
  });
  const invoice = await issueDemoInvoice(db, admin, id, { date: "2026-11-05" });
  await recordPayment(db, admin, {
    customerId: "demo-retailer-a",
    date: "2026-11-15",
    reference: "Later-dated collection",
    method: "cash",
    amount: "10",
    requestKey: randomUUID(),
    allocations: [{ invoiceId: invoice, amount: "10" }],
  });
  const early = await getReport(db, owner, "receivables", {
    ...f,
    to: "2026-11-10",
    asOf: "2026-11-10",
  });
  expect(early.rows).toHaveLength(1);
  money(early.totals.collected, "0");
  money(early.totals.outstanding, "52.5");
  const later = await getReport(db, owner, "receivables", {
    ...f,
    to: "2026-11-16",
    asOf: "2026-11-16",
  });
  money(later.totals.collected, "10");
  money(later.totals.outstanding, "42.5");
  const today = await businessToday(db),
    tomorrow = dayOffset(today, 1),
    run = (await getReport(db, owner, "production", f)).rows[0];
  await db.execute(
    sql`INSERT INTO nova.production_overheads(id,run_id,category,amount,reason,request_key,actor_id,created_at) VALUES(${randomUUID()},${run.run_id},'other',100,'Future timestamp boundary fixture',${randomUUID()},${production.id},${tomorrow}::date::timestamp AT TIME ZONE 'Asia/Kolkata')`,
  );
  const current = await getReport(db, owner, "production", {
    ...f,
    to: today,
    asOf: today,
  });
  money(current.rows[0].total_cost, "5855");
  const future = await getReport(db, owner, "production", {
    ...f,
    to: tomorrow,
    asOf: tomorrow,
  });
  money(future.rows[0].total_cost, "5955");
});
