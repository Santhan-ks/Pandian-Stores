import { sql } from "drizzle-orm";
import { invoicePrefix } from "../../lib/brand";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "../catalog/service";
import { AccessError, type Actor } from "../auth/policy";
import { Money as D, taxLine, financialYear } from "../billing/tax";
import { postDocument } from "../inventory/service";
import {
  invoiceConfiguration,
  validGstin,
  stateCodes,
  SAMPLE_NOTICE,
} from "../billing/profile";
const quantity = z.string().regex(/^[1-9]\d{0,8}$/);
const money = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/)
  .refine((v) => new D(v).gt(0));
const line = z
  .object({ productId: z.string().min(1), quantity, rate: money })
  .strict();
const key = z.string().min(8).max(100);
const date = z.iso.date();
export function salesAccess(actor: Actor | null, admin = false) {
  if (!actor) throw new AccessError(401, "Please sign in.");
  if (actor.role === "production" || (admin && actor.role !== "admin"))
    throw new AccessError(403, "Sales operation is not permitted.");
  return actor;
}
async function audit(
  db: Database,
  actor: Actor,
  id: string,
  action: string,
  before: unknown,
  after: unknown,
) {
  await db.execute(
    sql`INSERT INTO nova.audit_events(id,actor_id,document_id,action,before,after) VALUES(${randomUUID()},${actor.id},${id},${action},${JSON.stringify(before ?? null)}::jsonb,${JSON.stringify(after ?? null)}::jsonb)`,
  );
}
export async function listSales(db: Database, actor: Actor | null) {
  const user = salesAccess(actor);
  const orders = (
    await db.execute(
      sql`SELECT o.*,c.name AS customer,c.state,(SELECT jsonb_agg(jsonb_build_object('productId',l.product_id,'product',p.name,'quantity',l.quantity::text,'rate',l.rate::text,'gstPercent',l.gst_percent::text,'onHand',s.quantity::text,'shortage',greatest(l.quantity-s.quantity,0)::text)) FROM nova.sales_order_lines l JOIN nova.products p ON p.id=l.product_id JOIN nova.stock_summary s ON s.id=p.item_id WHERE l.order_id=o.id) AS lines,i.id AS invoice_id,i.number,i.snapshot,i.issuance_mode,i.invoice_date,sd.id AS dispatch_id,sd.posted_at AS dispatched_at,(SELECT CASE WHEN count(*) FILTER(WHERE m.value IS NULL)>0 THEN NULL ELSE -sum(m.value) END FROM nova.inventory_movements m WHERE m.document_id=sd.id)::text AS dispatch_cost,b.outstanding::text,EXISTS(SELECT 1 FROM nova.credit_notes n WHERE n.invoice_id=i.id) AS credited FROM nova.sales_orders o JOIN nova.customers c ON c.id=o.customer_id LEFT JOIN nova.invoices i ON i.order_id=o.id LEFT JOIN nova.dispatches d ON d.invoice_id=i.id LEFT JOIN nova.stock_documents sd ON sd.id=d.id LEFT JOIN nova.invoice_balances b ON b.id=i.id WHERE ${user.role !== "salesman"} OR (o.salesman_id=${user.id} AND EXISTS(SELECT 1 FROM nova.territories t WHERE t.id=c.territory_id AND t.salesman_id=${user.id})) ORDER BY o.created_at DESC`,
    )
  ).rows;
  const payments =
    user.role === "salesman"
      ? []
      : (
          await db.execute(
            sql`SELECT p.* FROM nova.payments p  ORDER BY p.created_at DESC`,
          )
        ).rows;
  return { orders, payments };
}
export async function submitOrder(
  db: Database,
  actor: Actor | null,
  input: unknown,
) {
  const user = salesAccess(actor);
  if (!["salesman", "admin"].includes(user.role))
    throw new AccessError(403, "Order entry is not permitted.");
  const data = z
    .object({
      customerId: z.string(),
      requestKey: key,
      lines: z.array(line).min(1).max(50),
    })
    .strict()
    .parse(input);
  if (new Set(data.lines.map((l) => l.productId)).size !== data.lines.length)
    throw new AccessError(422, "Products must be unique.");
  return db.transaction(async (tx) => {
    const customer = (
      await tx.execute(
        sql`SELECT c.* FROM nova.customers c JOIN nova.territories t ON t.id=c.territory_id WHERE c.id=${data.customerId} AND (${user.role === "admin"} OR t.salesman_id=${user.id}) FOR UPDATE OF c`,
      )
    ).rows[0];
    if (!customer)
      throw new AccessError(403, "Customer is outside your territory.");
    const old = (
      await tx.execute(
        sql`SELECT * FROM nova.sales_orders WHERE request_key=${data.requestKey}`,
      )
    ).rows[0];
    if (old) {
      const same = (
        await tx.execute(
          sql`SELECT id FROM nova.sales_orders WHERE request_key=${data.requestKey} AND payload=${JSON.stringify(data)}::jsonb AND salesman_id=${user.id}`,
        )
      ).rows[0];
      if (!same) throw new AccessError(409, "Request key already used.");
      return String(same.id);
    }
    const id = randomUUID();
    await tx.execute(
      sql`INSERT INTO nova.sales_orders(id,customer_id,salesman_id,request_key,payload) VALUES(${id},${data.customerId},${user.id},${data.requestKey},${JSON.stringify(data)}::jsonb)`,
    );
    for (const l of data.lines) {
      const price = (
        await tx.execute(
          sql`SELECT * FROM nova.product_prices WHERE product_id=${l.productId}`,
        )
      ).rows[0];
      if (!price || !new D(String(price.amount)).eq(l.rate))
        throw new AccessError(422, "Price changed; reload the price list.");
      await tx.execute(
        sql`INSERT INTO nova.sales_order_lines(id,order_id,product_id,quantity,rate,gst_percent) VALUES(${randomUUID()},${id},${l.productId},${l.quantity}::numeric,${l.rate}::numeric,${price.gst_percent}::numeric)`,
      );
    }
    await audit(tx, user, id, "order.submit", null, data);
    return id;
  });
}
export async function reviewOrder(
  db: Database,
  actor: Actor | null,
  id: string,
  input: unknown,
) {
  const user = salesAccess(actor, true);
  const data = z
    .object({
      decision: z.enum(["approve", "reject"]),
      reason: z.string().trim().min(3).max(500),
      lines: z.array(line).min(1).max(50).optional(),
    })
    .strict()
    .parse(input);
  return db.transaction(async (tx) => {
    const before = (
      await tx.execute(
        sql`SELECT * FROM nova.sales_orders WHERE id=${id} FOR UPDATE`,
      )
    ).rows[0];
    if (!before) throw new AccessError(404, "Order not found.");
    if (
      before.status === (data.decision === "approve" ? "approved" : "rejected")
    )
      return;
    if (before.status !== "submitted")
      throw new AccessError(409, "Only submitted orders may be reviewed.");
    if (data.lines) {
      if (
        new Set(data.lines.map((l) => l.productId)).size !== data.lines.length
      )
        throw new AccessError(422, "Duplicate product.");
      await tx.execute(
        sql`DELETE FROM nova.sales_order_lines WHERE order_id=${id}`,
      );
      for (const l of data.lines)
        await tx.execute(
          sql`INSERT INTO nova.sales_order_lines(id,order_id,product_id,quantity,rate,gst_percent) SELECT ${randomUUID()},${id},${l.productId},${l.quantity}::numeric,${l.rate}::numeric,gst_percent FROM nova.product_prices WHERE product_id=${l.productId}`,
        );
      const count = (
        await tx.execute(
          sql`SELECT count(*)::int AS n FROM nova.sales_order_lines WHERE order_id=${id}`,
        )
      ).rows[0];
      if (count.n !== data.lines.length)
        throw new AccessError(422, "Missing product price.");
    }
    if (data.decision === "approve") await checkStock(tx, id);
    const status = data.decision === "approve" ? "approved" : "rejected";
    await tx.execute(
      sql`UPDATE nova.sales_orders SET status=${status},reason=${data.reason} WHERE id=${id}`,
    );
    await audit(tx, user, id, "order.review", before, data);
  });
}
async function checkStock(db: Database, id: string) {
  await db.execute(
    sql`SELECT p.item_id FROM nova.sales_order_lines l JOIN nova.products p ON p.id=l.product_id JOIN nova.inventory_items i ON i.id=p.item_id WHERE l.order_id=${id} ORDER BY p.item_id FOR UPDATE OF i`,
  );
  const short = (
    await db.execute(
      sql`SELECT p.name,l.quantity-s.quantity AS shortage FROM nova.sales_order_lines l JOIN nova.products p ON p.id=l.product_id JOIN nova.stock_summary s ON s.id=p.item_id WHERE l.order_id=${id} AND l.quantity>s.quantity`,
    )
  ).rows[0];
  if (short)
    throw new AccessError(
      409,
      `${short.name}: shortage ${short.shortage} packets.`,
    );
}
async function issueConfiguredInvoice(
  db: Database,
  actor: Actor | null,
  id: string,
  input: unknown,
  mode: "real" | "demo",
) {
  const user = salesAccess(actor, true);
  const data = z
    .object({
      date,
      customerGstin: z
        .string()
        .regex(/^\d{2}[A-Z0-9]{13}$/)
        .optional(),
    })
    .strict()
    .parse(input);
  return db.transaction(async (tx) => {
    const order = (
      await tx.execute(
        sql`SELECT * FROM nova.sales_orders WHERE id=${id} FOR UPDATE`,
      )
    ).rows[0];
    if (!order) throw new AccessError(404, "Order not found.");
    const existing = (
      await tx.execute(
        sql`SELECT id,issuance_mode FROM nova.invoices WHERE order_id=${id}`,
      )
    ).rows[0];
    if (existing) {
      if (existing.issuance_mode !== mode)
        throw new AccessError(409, "Order already invoiced in another mode.");
      return String(existing.id);
    }
    const seller = await invoiceConfiguration(tx, mode);
    if (order.status !== "approved")
      throw new AccessError(409, "Approve the order first.");
    await checkStock(tx, id);
    const customer = (
      await tx.execute(
        sql`SELECT * FROM nova.customers WHERE id=${order.customer_id}`,
      )
    ).rows[0];
    const raw = (
      await tx.execute(
        sql`SELECT l.*,p.name,t.hsn FROM nova.sales_order_lines l JOIN nova.products p ON p.id=l.product_id LEFT JOIN nova.product_tax_settings t ON t.product_id=p.id AND t.mode=${mode} WHERE order_id=${id} ORDER BY product_id`,
      )
    ).rows;
    if (!stateCodes[String(customer.state)])
      throw new AccessError(422, "Unsupported place-of-supply state.");
    if (
      mode === "real" &&
      data.customerGstin &&
      !validGstin(data.customerGstin, stateCodes[String(customer.state)])
    )
      throw new AccessError(422, "Customer GSTIN failed validation.");
    if (raw.some((l) => !/^\d{4,8}$/.test(String(l.hsn))))
      throw new AccessError(422, "Configure an HSN for every ordered product.");
    const lines = raw.map((l) => ({
      productId: l.product_id,
      description: l.name,
      quantity: String(l.quantity),
      unit: "packet",
      rate: String(l.rate),
      gstPercent: String(l.gst_percent),
      hsn: String(l.hsn),
      ...taxLine(
        String(l.quantity),
        String(l.rate),
        String(l.gst_percent),
        String(seller.state),
        String(customer.state),
      ),
    }));
    const total = lines.reduce((s, l) => s.plus(l.total), new D(0)).toFixed(2);
    const fy = financialYear(data.date);
    const sequenceKey = mode === "demo" ? `SAMPLE/${fy}` : fy;
    const seq = (
      await tx.execute(
        sql`INSERT INTO nova.invoice_sequences(financial_year,last_number) VALUES(${sequenceKey},1) ON CONFLICT(financial_year) DO UPDATE SET last_number=nova.invoice_sequences.last_number+1 RETURNING last_number`,
      )
    ).rows[0];
    const number = `${mode === "demo" ? "SAMPLE" : invoicePrefix}/${fy}/${String(seq.last_number).padStart(5, "0")}`;
    const invoiceId = randomUUID();
    const snapshot = {
      seller,
      mode,
      notice: mode === "demo" ? SAMPLE_NOTICE : null,
      customer: { ...customer, gstin: data.customerGstin ?? null },
      placeOfSupply: customer.state,
      lines,
      total,
      number,
      date: data.date,
      financialYear: fy,
    };
    await tx.execute(
      sql`INSERT INTO nova.invoices(id,order_id,number,financial_year,invoice_date,snapshot,total,created_by,issuance_mode) VALUES(${invoiceId},${id},${number},${fy},${data.date},${JSON.stringify(snapshot)}::jsonb,${total}::numeric,${user.id},${mode})`,
    );
    await tx.execute(
      sql`UPDATE nova.sales_orders SET status='invoiced' WHERE id=${id}`,
    );
    await audit(tx, user, invoiceId, "invoice.issue", null, snapshot);
    return invoiceId;
  });
}
export async function dispatchOrder(
  db: Database,
  actor: Actor | null,
  id: string,
) {
  const user = salesAccess(actor, true);
  return db.transaction(async (tx) => {
    const order = (
      await tx.execute(
        sql`SELECT * FROM nova.sales_orders WHERE id=${id} FOR UPDATE`,
      )
    ).rows[0];
    if (!order) throw new AccessError(404, "Order not found.");
    if (order.status === "dispatched") return;
    if (order.status !== "invoiced")
      throw new AccessError(409, "An active invoice is required.");
    const invoice = (
      await tx.execute(
        sql`SELECT i.id FROM nova.invoices i WHERE order_id=${id} AND NOT EXISTS(SELECT 1 FROM nova.credit_notes c WHERE c.invoice_id=i.id) FOR UPDATE OF i`,
      )
    ).rows[0];
    if (!invoice) throw new AccessError(409, "Invoice is credited.");
    const doc = randomUUID();
    await tx.execute(
      sql`INSERT INTO nova.stock_documents(id,category,reason,request_key,payload,created_by) VALUES(${doc},'dispatch','Customer dispatch',${"dispatch-" + id},${JSON.stringify({ orderId: id })}::jsonb,${user.id})`,
    );
    await tx.execute(
      sql`INSERT INTO nova.dispatches(id,invoice_id) VALUES(${doc},${invoice.id})`,
    );
    await tx.execute(
      sql`INSERT INTO nova.stock_document_lines(id,document_id,item_id,quantity,unit) SELECT l.id||'-dispatch',${doc},p.item_id,-l.quantity,'packet' FROM nova.sales_order_lines l JOIN nova.products p ON p.id=l.product_id WHERE order_id=${id}`,
    );
    await postDocument(tx, user, doc);
    await tx.execute(
      sql`UPDATE nova.sales_orders SET status='dispatched' WHERE id=${id}`,
    );
    await audit(tx, user, id, "order.dispatch", order, { documentId: doc });
  });
}
export async function creditInvoice(
  db: Database,
  actor: Actor | null,
  id: string,
  reason: string,
) {
  const user = salesAccess(actor, true);
  z.string().trim().min(3).max(500).parse(reason);
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT o.id FROM nova.sales_orders o JOIN nova.invoices i ON i.order_id=o.id WHERE i.id=${id} FOR UPDATE OF o`,
    );
    const i = (
      await tx.execute(
        sql`SELECT * FROM nova.invoices WHERE id=${id} FOR UPDATE`,
      )
    ).rows[0];
    if (!i) throw new AccessError(404, "Invoice not found.");
    if (
      (
        await tx.execute(
          sql`SELECT id FROM nova.credit_notes WHERE invoice_id=${id}`,
        )
      ).rows.length
    )
      return;
    if (
      (
        await tx.execute(
          sql`SELECT payment_id FROM nova.payment_allocations WHERE invoice_id=${id}`,
        )
      ).rows.length
    )
      throw new AccessError(
        409,
        "Paid invoices require a refund workflow before crediting.",
      );
    await tx.execute(
      sql`INSERT INTO nova.credit_notes(id,invoice_id,reason,amount,actor_id) VALUES(${randomUUID()},${id},${reason},${i.total}::numeric,${user.id})`,
    );
    await tx.execute(
      sql`UPDATE nova.sales_orders SET status='cancelled',reason=${reason} WHERE id=${i.order_id}`,
    );
    await audit(tx, user, id, "invoice.credit", i, { reason, amount: i.total });
  });
}

export function issueInvoice(
  db: Database,
  actor: Actor | null,
  id: string,
  input: unknown,
) {
  return issueConfiguredInvoice(db, actor, id, input, "real");
}
export function issueDemoInvoice(
  db: Database,
  actor: Actor | null,
  id: string,
  input: unknown,
) {
  return issueConfiguredInvoice(db, actor, id, input, "demo");
}
