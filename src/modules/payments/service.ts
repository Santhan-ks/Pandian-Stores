import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "../catalog/service";
import type { Actor } from "../auth/policy";
import { AccessError } from "../auth/policy";
import { salesAccess } from "../sales/service";
import { Money as D } from "../billing/tax";
const amount = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/)
  .refine((v) => new D(v).gt(0));
export async function recordPayment(
  db: Database,
  actor: Actor | null,
  input: unknown,
) {
  const user = salesAccess(actor, true);
  const data = z
    .object({
      customerId: z.string(),
      date: z.iso.date(),
      reference: z.string().trim().min(3).max(100),
      method: z.enum(["cash", "bank", "upi", "cheque"]),
      amount,
      requestKey: z.string().min(8).max(100),
      allocations: z
        .array(z.object({ invoiceId: z.string(), amount }).strict())
        .min(1)
        .max(100),
    })
    .strict()
    .parse(input);
  if (
    new Set(data.allocations.map((a) => a.invoiceId)).size !==
      data.allocations.length ||
    !data.allocations
      .reduce((s, a) => s.plus(a.amount), new D(0))
      .eq(data.amount)
  )
    throw new AccessError(
      422,
      "Allocate the exact payment amount to distinct invoices.",
    );
  return db.transaction(async (tx) => {
    // Serialize payments for a customer, then lock invoices in stable order against credits.
    await tx.execute(
      sql`SELECT id FROM nova.customers WHERE id=${data.customerId} FOR UPDATE`,
    );
    const old = (
      await tx.execute(
        sql`SELECT id FROM nova.payments WHERE request_key=${data.requestKey} AND payload=${JSON.stringify(data)}::jsonb AND actor_id=${user.id}`,
      )
    ).rows[0];
    if (old) return String(old.id);
    if (
      (
        await tx.execute(
          sql`SELECT id FROM nova.payments WHERE request_key=${data.requestKey}`,
        )
      ).rows.length
    )
      throw new AccessError(409, "Payment key already used.");
    for (const a of [...data.allocations].sort((a, b) =>
      a.invoiceId.localeCompare(b.invoiceId),
    )) {
      const i = (
        await tx.execute(
          sql`SELECT i.id FROM nova.invoices i JOIN nova.sales_orders o ON o.id=i.order_id WHERE i.id=${a.invoiceId} AND o.customer_id=${data.customerId} FOR UPDATE OF i`,
        )
      ).rows[0];
      if (!i)
        throw new AccessError(422, "Invoice does not belong to this customer.");
      const balance = (
        await tx.execute(
          sql`SELECT outstanding FROM nova.invoice_balances WHERE id=${a.invoiceId}`,
        )
      ).rows[0];
      if (new D(a.amount).gt(String(balance.outstanding)))
        throw new AccessError(422, "Allocation exceeds outstanding.");
    }
    const id = randomUUID();
    await tx.execute(
      sql`INSERT INTO nova.payments(id,customer_id,payment_date,reference,method,amount,request_key,payload,actor_id) VALUES(${id},${data.customerId},${data.date},${data.reference},${data.method},${data.amount}::numeric,${data.requestKey},${JSON.stringify(data)}::jsonb,${user.id})`,
    );
    for (const a of data.allocations)
      await tx.execute(
        sql`INSERT INTO nova.payment_allocations(payment_id,invoice_id,amount) VALUES(${id},${a.invoiceId},${a.amount}::numeric)`,
      );
    await tx.execute(
      sql`INSERT INTO nova.audit_events(id,actor_id,action,document_id,after) VALUES(${randomUUID()},${user.id},'payment.record',${id},${JSON.stringify(data)}::jsonb)`,
    );
    return id;
  });
}
