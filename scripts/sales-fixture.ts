import { saveProfile } from "../src/modules/billing/profile";
import { sql } from "drizzle-orm";
import type { Database } from "../src/modules/catalog/service";
import {
  submitOrder,
  reviewOrder,
  issueDemoInvoice,
  dispatchOrder,
} from "../src/modules/sales/service";
import { recordPayment } from "../src/modules/payments/service";
import { Money as D } from "../src/modules/billing/tax";
// Explicitly invented exercise identity; never supplied as a real seller default.
export const exerciseInvoice = { date: "2026-11-17" };
export const exerciseProfile = {
  mode: "demo" as const,
  name: "Pandian Stores (fictional demo)",
  address: "Invented exercise address, Tamil Nadu",
  state: "Tamil Nadu" as const,
  gstin: "DEMO-NOT-A-GSTIN",
  products: [{ productId: "demo-murukku", hsn: "1905" }],
};
export async function seedDemoBilling(db: Database) {
  const existing = (
    await db.execute(
      sql`SELECT mode FROM nova.business_profiles WHERE mode='demo'`,
    )
  ).rows[0];
  if (!existing)
    await saveProfile(db, { id: "demo-admin", role: "admin" }, exerciseProfile);
}
export async function salesFixture(db: Database) {
  await seedDemoBilling(db);
  const admin = { id: "demo-admin", role: "admin" } as const;
  const first = await submitOrder(
    db,
    { id: "demo-salesman-a", role: "salesman" },
    {
      customerId: "demo-retailer-a",
      requestKey: "demo-stage4-retailer-order",
      lines: [{ productId: "demo-murukku", quantity: "150", rate: "50.00" }],
    },
  );
  const existing = (
    await db.execute(
      sql`SELECT status FROM nova.sales_orders WHERE id=${first}`,
    )
  ).rows[0];
  if (existing.status === "submitted")
    await reviewOrder(db, admin, first, {
      decision: "approve",
      reason: "Benchmark stock checked",
    });
  const invoice = await issueDemoInvoice(db, admin, first, exerciseInvoice);
  await dispatchOrder(db, admin, first);
  const second = await submitOrder(
    db,
    { id: "demo-salesman-b", role: "salesman" },
    {
      customerId: "demo-distributor-b",
      requestKey: "demo-stage4-distributor-order",
      lines: [{ productId: "demo-murukku", quantity: "120", rate: "50.00" }],
    },
  );
  let shortage = false;
  try {
    await reviewOrder(db, admin, second, {
      decision: "approve",
      reason: "Benchmark shortage check",
    });
  } catch (e) {
    if (e instanceof Error && /shortage 32/.test(e.message)) shortage = true;
    else throw e;
  }
  if (!shortage) throw new Error("Expected 32-packet shortage");
  await recordPayment(db, admin, {
    customerId: "demo-retailer-a",
    date: "2026-11-17",
    reference: "Exercise collection 4000",
    method: "bank",
    amount: "4000",
    requestKey: "demo-stage4-payment",
    allocations: [{ invoiceId: invoice, amount: "4000" }],
  });
  const balance = (
    await db.execute(
      sql`SELECT outstanding FROM nova.invoice_balances WHERE id=${invoice}`,
    )
  ).rows[0];
  const stock = (
    await db.execute(
      sql`SELECT quantity FROM nova.stock_summary WHERE id='demo-finished'`,
    )
  ).rows[0];
  if (
    !new D(String(balance.outstanding)).eq(3875) ||
    !new D(String(stock.quantity)).eq(88)
  )
    throw new Error("Stage 4 checkpoint differs; use a fresh demo database");
  console.log(
    "Stage 4 verified: stock 88; invoice 7875; paid 4000; outstanding 3875; shortage 32.",
  );
}
