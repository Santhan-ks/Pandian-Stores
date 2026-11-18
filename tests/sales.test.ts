import { beforeEach, afterAll, test, expect } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "../src/lib/db/schema";
import { seedDemo } from "../scripts/seed-data";
import { inventoryFixture } from "../scripts/inventory-fixture";
import { productionFixture } from "../scripts/production-fixture";
import {
  submitOrder,
  reviewOrder,
  issueDemoInvoice as issueInvoice,
  issueInvoice as issueRealInvoice,
  dispatchOrder,
  listSales,
  creditInvoice,
} from "../src/modules/sales/service";
import { recordPayment } from "../src/modules/payments/service";
import { financialYear, taxLine, Money as D } from "../src/modules/billing/tax";
import { invoicePdf } from "../src/modules/billing/pdf";
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  url === process.env.DATABASE_URL ||
  !new URL(url).pathname.endsWith("_test")
)
  throw new Error("Isolated test database required");
const pool = new Pool({ connectionString: url });
const db = drizzle(pool, { schema });
const admin = { id: "demo-admin", role: "admin" } as const;
const a = { id: "demo-salesman-a", role: "salesman" } as const;
const b = { id: "demo-salesman-b", role: "salesman" } as const;
const auditor = { id: "demo-auditor", role: "auditor" } as const;
import {
  exerciseInvoice,
  exerciseProfile,
  seedDemoBilling,
} from "../scripts/sales-fixture";
function order(customerId = "demo-retailer-a", qty = "150") {
  return {
    customerId,
    requestKey: randomUUID(),
    lines: [{ productId: "demo-murukku", quantity: qty, rate: "50.00" }],
  };
}
async function approved(qty = "150") {
  const id = await submitOrder(db, a, order("demo-retailer-a", qty));
  await reviewOrder(db, admin, id, {
    decision: "approve",
    reason: "Stock checked",
  });
  return id;
}
async function invoiced(qty = "150") {
  const id = await approved(qty);
  const invoice = await issueInvoice(db, admin, id, exerciseInvoice);
  return { id, invoice };
}
function payment(invoice: string, amount = "4000") {
  return {
    customerId: "demo-retailer-a",
    date: "2026-11-17",
    reference: "Test collection",
    method: "bank",
    amount,
    requestKey: randomUUID(),
    allocations: [{ invoiceId: invoice, amount }],
  };
}
beforeEach(async () => {
  process.env.NOVA_ALLOW_DEMO_INVOICES = "true";
  await db.execute(
    sql`TRUNCATE nova.users,nova.roles,nova.units,nova.inventory_items,nova.territories CASCADE`,
  );
  await seedDemo(db, process.env.DEMO_PASSWORD ?? randomUUID());
  await inventoryFixture(db);
  await productionFixture(db);
  await seedDemoBilling(db);
}, 30000);
afterAll(() => pool.end());
test("exact Stage 4 benchmark, shortage, IGST preview, PDF and partial payment", async () => {
  const before = (
    await db.execute(
      sql`SELECT quantity FROM nova.stock_summary WHERE id='demo-finished'`,
    )
  ).rows[0];
  expect(new D(String(before.quantity)).eq(238)).toBe(true);
  const { id, invoice } = await invoiced();
  expect(
    new D(
      String(
        (
          await db.execute(
            sql`SELECT quantity FROM nova.stock_summary WHERE id='demo-finished'`,
          )
        ).rows[0].quantity,
      ),
    ).eq(238),
  ).toBe(true);
  const i = (
    await db.execute(sql`SELECT * FROM nova.invoices WHERE id=${invoice}`)
  ).rows[0];
  const snap = i.snapshot as { lines: ReturnType<typeof taxLine>[] };
  expect(snap.lines[0]).toMatchObject({
    taxable: "7500.00",
    cgst: "187.50",
    sgst: "187.50",
    igst: "0.00",
    total: "7875.00",
  });
  expect(
    invoicePdf(i.snapshot as Record<string, unknown>).toString(),
  ).toContain("%PDF-1.4");
  await dispatchOrder(db, admin, id);
  await dispatchOrder(db, admin, id);
  const stock = (
    await db.execute(
      sql`SELECT * FROM nova.stock_summary WHERE id='demo-finished'`,
    )
  ).rows[0];
  expect(new D(String(stock.quantity)).eq(88)).toBe(true);
  expect(stock.value).toBeNull();
  const movements = (
    await db.execute(
      sql`SELECT m.*,d.category,d.status,x.invoice_id,i.order_id FROM nova.inventory_movements m JOIN nova.stock_documents d ON d.id=m.document_id JOIN nova.dispatches x ON x.id=d.id JOIN nova.invoices i ON i.id=x.invoice_id WHERE i.order_id=${id}`,
    )
  ).rows;
  expect(movements).toHaveLength(1);
  expect(movements[0]).toMatchObject({
    category: "dispatch",
    status: "posted",
    invoice_id: invoice,
    order_id: id,
    actor_id: admin.id,
    item_id: "demo-finished",
    base_unit: "packet",
    value: null,
  });
  expect(new D(String(movements[0].quantity)).eq(-150)).toBe(true);
  expect(new D(String(movements[0].quantity_before)).eq(238)).toBe(true);
  expect(new D(String(movements[0].quantity_after)).eq(88)).toBe(true);
  await expect(
    db.execute(
      sql`UPDATE nova.inventory_movements SET value=0 WHERE id=${movements[0].id}`,
    ),
  ).rejects.toThrow();
  const second = await submitOrder(db, b, order("demo-distributor-b", "120"));
  await expect(
    reviewOrder(db, admin, second, {
      decision: "approve",
      reason: "Check shortage",
    }),
  ).rejects.toThrow(/shortage 32/);
  await expect(
    issueInvoice(db, admin, second, exerciseInvoice),
  ).rejects.toThrow(/Approve/);
  expect(taxLine("120", "50", "5", "Tamil Nadu", "Karnataka")).toMatchObject({
    igst: "300.00",
    cgst: "0.00",
    sgst: "0.00",
  });
  await expect(dispatchOrder(db, b, second)).rejects.toThrow(/permitted/);
  await expect(dispatchOrder(db, admin, second)).rejects.toThrow(/invoice/);
  expect(
    (
      await db.execute(
        sql`SELECT * FROM nova.inventory_movements WHERE document_id=${movements[0].document_id}`,
      )
    ).rows,
  ).toHaveLength(1);
  expect(
    new D(
      String(
        (
          await db.execute(
            sql`SELECT quantity FROM nova.stock_summary WHERE id='demo-finished'`,
          )
        ).rows[0].quantity,
      ),
    ).eq(88),
  ).toBe(true);
  expect(
    (
      await db.execute(
        sql`SELECT id FROM nova.invoices WHERE order_id=${second}`,
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await db.execute(
        sql`SELECT status FROM nova.sales_orders WHERE id=${second}`,
      )
    ).rows[0].status,
  ).toBe("submitted");
  const p = payment(invoice);
  expect(await recordPayment(db, admin, p)).toBe(
    await recordPayment(db, admin, p),
  );
  const bal = (
    await db.execute(
      sql`SELECT outstanding FROM nova.invoice_balances WHERE id=${invoice}`,
    )
  ).rows[0];
  expect(new D(String(bal.outstanding)).eq(3875)).toBe(true);
  const events = (
    await db.execute(sql`SELECT action FROM nova.audit_events`)
  ).rows.map((r) => r.action);
  expect(events).toEqual(
    expect.arrayContaining([
      "order.submit",
      "order.review",
      "invoice.issue",
      "order.dispatch",
      "payment.record",
    ]),
  );
});
test("customer isolation, price validation, unauthorized writes and reads", async () => {
  await expect(submitOrder(db, a, order("demo-distributor-b"))).rejects.toThrow(
    /territory/,
  );
  const bad = order();
  bad.lines[0].rate = "1";
  await expect(submitOrder(db, a, bad)).rejects.toThrow(/Price/);
  const id = await submitOrder(db, a, order());
  expect((await listSales(db, b)).orders).toHaveLength(0);
  await expect(
    reviewOrder(db, a, id, { decision: "approve", reason: "Denied" }),
  ).rejects.toThrow(/permitted/);
  await expect(submitOrder(db, auditor, order())).rejects.toThrow(/permitted/);
  await expect(listSales(db, null)).rejects.toThrow(/sign in/);
  await expect(dispatchOrder(db, auditor, id)).rejects.toThrow(/permitted/);
});
test("review modifications and rejection, immutable approved details, idempotent submission", async () => {
  const data = order();
  const id = await submitOrder(db, a, data);
  expect(await submitOrder(db, a, data)).toBe(id);
  await reviewOrder(db, admin, id, {
    decision: "approve",
    reason: "Agreed discount",
    lines: [{ productId: "demo-murukku", quantity: "140", rate: "49.50" }],
  });
  await expect(
    db.execute(
      sql`UPDATE nova.sales_order_lines SET quantity=1 WHERE order_id=${id}`,
    ),
  ).rejects.toThrow();
  const i = await issueInvoice(db, admin, id, exerciseInvoice);
  expect(await issueInvoice(db, admin, id, exerciseInvoice)).toBe(i);
  await expect(
    db.execute(sql`UPDATE nova.invoices SET total=1 WHERE id=${i}`),
  ).rejects.toThrow();
  const rejected = await submitOrder(db, a, order());
  await reviewOrder(db, admin, rejected, {
    decision: "reject",
    reason: "Customer withdrew",
  });
  await expect(
    issueInvoice(db, admin, rejected, exerciseInvoice),
  ).rejects.toThrow();
});
test("concurrent dispatches cannot oversell and failed transaction leaves no dispatch draft", async () => {
  const first = await invoiced();
  const second = await invoiced();
  const results = await Promise.allSettled([
    dispatchOrder(db, admin, first.id),
    dispatchOrder(db, admin, second.id),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    (await db.execute(sql`SELECT * FROM nova.dispatches`)).rows,
  ).toHaveLength(1);
  expect(
    (
      await db.execute(
        sql`SELECT * FROM nova.stock_documents WHERE category='dispatch'`,
      )
    ).rows,
  ).toHaveLength(1);
});
test("concurrent invoice sequence numbers and financial-year rollover", async () => {
  const x = await approved("10"),
    y = await approved("10");
  await Promise.all([
    issueInvoice(db, admin, x, exerciseInvoice),
    issueInvoice(db, admin, y, exerciseInvoice),
  ]);
  const nums = (
    await db.execute(sql`SELECT number FROM nova.invoices`)
  ).rows.map((r) => r.number);
  expect(new Set(nums).size).toBe(2);
  expect(financialYear("2026-03-31")).toBe("2025-26");
  expect(financialYear("2026-04-01")).toBe("2026-27");
  expect(taxLine("1", "0.20", "5", "Tamil Nadu", "Tamil Nadu")).toMatchObject({
    taxable: "0.20",
    cgst: "0.01",
    sgst: "0.01",
    total: "0.22",
  });
});
test("payment over-allocation rollback, concurrent allocations and immutable payments", async () => {
  const { invoice } = await invoiced();
  await expect(
    recordPayment(db, admin, payment(invoice, "8000")),
  ).rejects.toThrow(/exceeds/);
  expect(
    (await db.execute(sql`SELECT * FROM nova.payments`)).rows,
  ).toHaveLength(0);
  const results = await Promise.allSettled([
    recordPayment(db, admin, payment(invoice, "5000")),
    recordPayment(db, admin, payment(invoice, "5000")),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  await expect(
    db.execute(sql`UPDATE nova.payments SET amount=1`),
  ).rejects.toThrow();
  await expect(
    creditInvoice(db, admin, invoice, "Cancel paid invoice"),
  ).rejects.toThrow(/refund/);
});
test("full credit preserves invoice, zeros receivable and never reverses dispatch", async () => {
  const { id, invoice } = await invoiced();
  await dispatchOrder(db, admin, id);
  await creditInvoice(db, admin, invoice, "Exercise credit");
  await creditInvoice(db, admin, invoice, "Exercise credit");
  expect(
    (await db.execute(sql`SELECT * FROM nova.credit_notes`)).rows,
  ).toHaveLength(1);
  expect(
    new D(
      String(
        (
          await db.execute(
            sql`SELECT outstanding FROM nova.invoice_balances WHERE id=${invoice}`,
          )
        ).rows[0].outstanding,
      ),
    ).isZero(),
  ).toBe(true);
  expect(
    new D(
      String(
        (
          await db.execute(
            sql`SELECT quantity FROM nova.stock_summary WHERE id='demo-finished'`,
          )
        ).rows[0].quantity,
      ),
    ).eq(88),
  ).toBe(true);
  await expect(recordPayment(db, admin, payment(invoice))).rejects.toThrow(
    /exceeds/,
  );
});
import {
  saveProfile,
  validGstin,
  SAMPLE_NOTICE,
} from "../src/modules/billing/profile";
test("real issuance requires a validated database profile and product HSN; demo identity is rejected", async () => {
  const id = await approved("10");
  await expect(
    issueRealInvoice(db, admin, id, { date: "2026-11-17" }),
  ).rejects.toThrow(/profile/);
  await expect(
    saveProfile(db, admin, { ...exerciseProfile, mode: "real" }),
  ).rejects.toThrow(/GSTIN/);
  expect(validGstin(exerciseProfile.gstin, "33")).toBe(false);
  expect(validGstin("33ABCDE1234F1Z7", "33")).toBe(true);
  expect(validGstin("33ABCDE1234F1Z0", "33")).toBe(false);
  expect(validGstin("33ABCDE1234F1Z7", "29")).toBe(false);
  const real = {
    ...exerciseProfile,
    mode: "real",
    name: "Synthetic validation fixture only",
    gstin: "33ABCDE1234F1Z7",
  };
  await saveProfile(db, admin, real);
  await db.execute(
    sql`DELETE FROM nova.product_tax_settings WHERE mode='real'`,
  );
  await expect(
    issueRealInvoice(db, admin, id, { date: "2026-11-17" }),
  ).rejects.toThrow(/HSN/);
  await saveProfile(db, admin, real);
  await expect(
    issueRealInvoice(db, admin, id, {
      date: "2026-11-17",
      seller: exerciseProfile,
    }),
  ).rejects.toThrow();
  const invoice = await issueRealInvoice(db, admin, id, { date: "2026-11-17" });
  const before = (
    await db.execute(
      sql`SELECT snapshot,issuance_mode FROM nova.invoices WHERE id=${invoice}`,
    )
  ).rows[0];
  expect(before.issuance_mode).toBe("real");
  expect((before.snapshot as { seller: { name: string } }).seller.name).toBe(
    real.name,
  );
  expect(
    invoicePdf(before.snapshot as Record<string, unknown>).toString("latin1"),
  ).not.toContain("SAMPLE INVOICE");
  await saveProfile(db, admin, {
    ...real,
    name: "Changed business name",
    products: [{ productId: "demo-murukku", hsn: "9999" }],
  });
  await db.execute(
    sql`UPDATE nova.customers SET address='Changed later billing address' WHERE id='demo-retailer-a'`,
  );
  expect(
    (
      await db.execute(
        sql`SELECT snapshot FROM nova.invoices WHERE id=${invoice}`,
      )
    ).rows[0].snapshot,
  ).toEqual(before.snapshot);
  await expect(issueInvoice(db, admin, id, exerciseInvoice)).rejects.toThrow(
    /another mode/,
  );
});
test("sample issuance is explicitly enabled and visibly labelled; real rates remain configurable", async () => {
  const id = await approved("10");
  process.env.NOVA_ALLOW_DEMO_INVOICES = "false";
  await expect(issueInvoice(db, admin, id, exerciseInvoice)).rejects.toThrow(
    /disabled/,
  );
  process.env.NOVA_ALLOW_DEMO_INVOICES = "true";
  const invoice = await issueInvoice(db, admin, id, exerciseInvoice);
  const snapshot = (
    await db.execute(
      sql`SELECT snapshot FROM nova.invoices WHERE id=${invoice}`,
    )
  ).rows[0].snapshot as Record<string, unknown>;
  expect(snapshot.notice).toBe(SAMPLE_NOTICE);
  expect(snapshot.mode).toBe("demo");
  expect(String(snapshot.number)).toMatch(/^SAMPLE\//);
  expect(invoicePdf(snapshot).toString("latin1")).toContain(
    "SAMPLE INVOICE \x97 NOT VALID FOR TAX PURPOSES",
  );
  await db.execute(
    sql`UPDATE nova.product_prices SET gst_percent=12 WHERE product_id='demo-murukku'`,
  );
  await saveProfile(db, admin, {
    ...exerciseProfile,
    mode: "real",
    name: "Synthetic validation fixture only",
    gstin: "33ABCDE1234F1Z7",
  });
  const realOrder = await approved("10");
  const realInvoice = await issueRealInvoice(db, admin, realOrder, {
    date: "2026-11-17",
  });
  const realSnapshot = (
    await db.execute(
      sql`SELECT snapshot FROM nova.invoices WHERE id=${realInvoice}`,
    )
  ).rows[0].snapshot as { number: string; lines: Record<string, string>[] };
  expect(realSnapshot.number).toMatch(/^PANDIAN\/2026-27\//);
  expect(realSnapshot.lines[0]).toMatchObject({
    gstPercent: "12.00",
    cgst: "30.00",
    sgst: "30.00",
    total: "560.00",
  });
  await expect(saveProfile(db, a, exerciseProfile)).rejects.toThrow(/admins/);
  await expect(saveProfile(db, auditor, exerciseProfile)).rejects.toThrow(
    /admins/,
  );
});
import { readProfiles } from "../src/modules/billing/profile";
test("an existing payment cannot receive extra allocations beyond its immutable amount", async () => {
  const first = await invoiced("10"),
    second = await invoiced("10");
  const paymentId = await recordPayment(
    db,
    admin,
    payment(first.invoice, "100"),
  );
  await expect(
    db.transaction(async (tx) => {
      await tx.execute(
        sql`INSERT INTO nova.payment_allocations(payment_id,invoice_id,amount) VALUES(${paymentId},${second.invoice},1)`,
      );
    }),
  ).rejects.toThrow();
  const allocated = (
    await db.execute(
      sql`SELECT sum(amount)::text AS amount FROM nova.payment_allocations WHERE payment_id=${paymentId}`,
    )
  ).rows[0];
  expect(new D(String(allocated.amount)).eq(100)).toBe(true);
});

test("actual interstate invoice and independent financial-year numbering use stored supply details", async () => {
  const id = await submitOrder(db, b, order("demo-distributor-b", "120"));
  await reviewOrder(db, admin, id, {
    decision: "approve",
    reason: "Stock available before benchmark dispatch",
  });
  const invoice = await issueInvoice(db, admin, id, { date: "2026-03-31" });
  const row = (
    await db.execute(sql`SELECT * FROM nova.invoices WHERE id=${invoice}`)
  ).rows[0];
  expect(row.financial_year).toBe("2025-26");
  expect(String(row.number)).toMatch(/^SAMPLE\/2025-26\//);
  const snapshot = row.snapshot as {
    seller: { state: string };
    customer: { state: string };
    lines: ReturnType<typeof taxLine>[];
  };
  expect(snapshot.seller.state).toBe("Tamil Nadu");
  expect(snapshot.customer.state).toBe("Karnataka");
  expect(snapshot.lines[0]).toMatchObject({
    taxable: "6000.00",
    cgst: "0.00",
    sgst: "0.00",
    igst: "300.00",
    total: "6300.00",
  });
  const next = await approved("10");
  const nextInvoice = await issueInvoice(db, admin, next, {
    date: "2026-04-01",
  });
  const nextRow = (
    await db.execute(
      sql`SELECT number,financial_year FROM nova.invoices WHERE id=${nextInvoice}`,
    )
  ).rows[0];
  expect(nextRow.financial_year).toBe("2026-27");
  expect(String(nextRow.number)).toMatch(/^SAMPLE\/2026-27\//);
  const sequences = (
    await db.execute(
      sql`SELECT financial_year FROM nova.invoice_sequences WHERE financial_year IN ('SAMPLE/2025-26','SAMPLE/2026-27')`,
    )
  ).rows;
  expect(sequences).toHaveLength(2);
  await expect(readProfiles(db, a)).rejects.toThrow(/admins/);
  await expect(readProfiles(db, auditor)).rejects.toThrow(/admins/);
});

test("payment allocations reject mismatched totals, other customers and conflicting request retries", async () => {
  const { invoice } = await invoiced();
  const data = payment(invoice, "100");
  await expect(
    recordPayment(db, admin, { ...data, amount: "101" }),
  ).rejects.toThrow(/exact payment/);
  await expect(
    recordPayment(db, admin, { ...data, customerId: "demo-distributor-b" }),
  ).rejects.toThrow(/customer/);
  await expect(recordPayment(db, auditor, data)).rejects.toThrow(/permitted/);
  await recordPayment(db, admin, data);
  await expect(
    recordPayment(db, admin, { ...data, reference: "Different operation" }),
  ).rejects.toThrow(/already used/);
  const totals = (
    await db.execute(
      sql`SELECT count(*)::int AS n,sum(amount)::text AS amount FROM nova.payments`,
    )
  ).rows[0];
  expect(totals.n).toBe(1);
  expect(new D(String(totals.amount)).eq(100)).toBe(true);
});
test("database order guards prevent reopening approved orders or moving their frozen lines", async () => {
  const id = await approved("10");
  const other = await submitOrder(db, a, order("demo-retailer-a", "10"));
  await expect(
    db.transaction(async (tx) => {
      await tx.execute(
        sql`UPDATE nova.sales_orders SET status='submitted' WHERE id=${id}`,
      );
    }),
  ).rejects.toThrow();
  await expect(
    db.transaction(async (tx) => {
      await tx.execute(
        sql`UPDATE nova.sales_order_lines SET order_id=${other} WHERE order_id=${id}`,
      );
    }),
  ).rejects.toThrow();
});
test("database full-credit guard rejects paid invoices and mismatched credit values", async () => {
  const { invoice } = await invoiced("10");
  await recordPayment(db, admin, payment(invoice, "100"));
  await expect(
    db.transaction(async (tx) => {
      await tx.execute(
        sql`INSERT INTO nova.credit_notes(id,invoice_id,reason,amount,actor_id) VALUES(${randomUUID()},${invoice},'Direct credit regression',525,${admin.id})`,
      );
    }),
  ).rejects.toThrow();
  const second = await invoiced("10");
  await expect(
    db.transaction(async (tx) => {
      await tx.execute(
        sql`INSERT INTO nova.credit_notes(id,invoice_id,reason,amount,actor_id) VALUES(${randomUUID()},${second.invoice},'Invalid partial credit',1,${admin.id})`,
      );
    }),
  ).rejects.toThrow();
});
test("sales history and invoice access follow current territory assignment as well as order ownership", async () => {
  await invoiced("10");
  await db.execute(
    sql`UPDATE nova.customers SET territory_id='demo-territory-b' WHERE id='demo-retailer-a'`,
  );
  expect((await listSales(db, a)).orders).toHaveLength(0);
  expect((await listSales(db, b)).orders).toHaveLength(0);
  expect((await listSales(db, admin)).orders).toHaveLength(1);
});
