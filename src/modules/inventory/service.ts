import { sql } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Database } from "../catalog/service";
import { AccessError, type Actor } from "../auth/policy";

export async function reviseDraft(
  db: Database,
  actor: Actor | null,
  id: string,
  input: unknown,
) {
  const data = documentInput.parse(input);
  const user = inventoryAccess(actor, data.category);
  return db.transaction(async (tx) => {
    const previous = (
      await tx.execute(
        sql`SELECT * FROM nova.stock_documents WHERE id=${id} FOR UPDATE`,
      )
    ).rows[0];
    if (!previous) throw new AccessError(404, "Document not found.");
    inventoryAccess(actor, String(previous.category));
    if (previous.status !== "draft")
      throw new AccessError(409, "Posted documents are immutable.");
    if (data.requestKey !== previous.request_key)
      throw new AccessError(409, "Document key cannot change.");
    await tx.execute(
      sql`UPDATE nova.stock_documents SET category=${data.category},supplier_id=${data.supplierId},reason=${data.reason},payload=${JSON.stringify(data)}::jsonb WHERE id=${id}`,
    );
    await tx.execute(
      sql`DELETE FROM nova.stock_document_lines WHERE document_id=${id}`,
    );
    for (const l of data.lines)
      await tx.execute(
        sql`INSERT INTO nova.stock_document_lines(id,document_id,item_id,quantity,unit,unit_rate) VALUES(${randomUUID()},${id},${l.itemId},${l.quantity}::numeric,${l.unit},${l.unitRate}::numeric)`,
      );
    await tx.execute(
      sql`INSERT INTO nova.audit_events(id,actor_id,action,document_id,before,after) VALUES(${randomUUID()},${user.id},'stock.edit',${id},${JSON.stringify(previous)}::jsonb,${JSON.stringify(data)}::jsonb)`,
    );
    return id;
  });
}

const decimal = z.string().regex(/^-?\d{1,14}(\.\d{1,6})?$/);
export const documentInput = z
  .object({
    category: z.enum(["opening", "purchase", "adjustment"]),
    supplierId: z.string().nullable(),
    reason: z.string().trim().min(3).max(500),
    requestKey: z.string().min(8).max(100),
    lines: z
      .array(
        z
          .object({
            itemId: z.string().min(1),
            quantity: decimal,
            unit: z.enum(["g", "kg", "ml", "L", "piece", "packet"]),
            unitRate: decimal.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (v) => new Set(v.lines.map((l) => l.itemId)).size === v.lines.length,
    "Duplicate item",
  );
export function inventoryAccess(actor: Actor | null, category?: string) {
  if (!actor) throw new AccessError(401, "Please sign in.");
  if (
    actor.role === "salesman" ||
    (category &&
      actor.role !== "admin" &&
      !(actor.role === "production" && category === "purchase"))
  )
    throw new AccessError(403, "Inventory operation is not permitted.");
  return actor;
}
export async function createDocument(
  db: Database,
  actor: Actor | null,
  input: unknown,
) {
  const data = documentInput.parse(input);
  const user = inventoryAccess(actor, data.category);
  return db.transaction(async (tx) => {
    const id = randomUUID();
    const inserted = await tx.execute(
      sql`INSERT INTO nova.stock_documents(id,category,supplier_id,reason,request_key,payload,created_by) VALUES(${id},${data.category},${data.supplierId},${data.reason},${data.requestKey},${JSON.stringify(data)}::jsonb,${user.id}) ON CONFLICT(request_key) DO NOTHING RETURNING id`,
    );
    if (!inserted.rows.length) {
      const existing = await tx.execute(
        sql`SELECT id,payload,created_by FROM nova.stock_documents WHERE request_key=${data.requestKey}`,
      );
      const same = await tx.execute(
        sql`SELECT id FROM nova.stock_documents WHERE request_key=${data.requestKey} AND payload=${JSON.stringify(data)}::jsonb AND created_by=${user.id}`,
      );
      if (!same.rows.length)
        throw new AccessError(
          409,
          "Idempotency key was already used for a different request.",
        );
      return String(existing.rows[0].id);
    }
    for (const line of data.lines)
      await tx.execute(
        sql`INSERT INTO nova.stock_document_lines(id,document_id,item_id,quantity,unit,unit_rate) VALUES(${randomUUID()},${id},${line.itemId},${line.quantity}::numeric,${line.unit},${line.unitRate}::numeric)`,
      );
    await tx.execute(
      sql`INSERT INTO nova.audit_events(id,actor_id,action,document_id,after) VALUES(${randomUUID()},${user.id},'stock.draft',${id},${JSON.stringify(data)}::jsonb)`,
    );
    return id;
  });
}
export async function postDocument(
  db: Database,
  actor: Actor | null,
  id: string,
) {
  return db.transaction(async (tx) => {
    const result = await tx.execute(
      sql`SELECT * FROM nova.stock_documents WHERE id=${id} FOR UPDATE`,
    );
    const document = result.rows[0];
    if (!document) throw new AccessError(404, "Document not found.");
    const user = inventoryAccess(actor, String(document.category));
    if (document.status === "posted") return id;
    await tx.execute(
      sql`UPDATE nova.stock_documents SET status='posted',posted_by=${user.id},posted_at=now() WHERE id=${id}`,
    );
    return id;
  });
}
export async function readInventory(
  db: Database,
  actor: Actor | null,
  filters: {
    item?: string;
    category?: string;
    from?: string;
    to?: string;
  } = {},
) {
  inventoryAccess(actor);
  const filter = z
    .object({
      item: z.string().optional(),
      category: z.enum(["opening", "purchase", "adjustment", ""]).optional(),
      from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .or(z.literal(""))
        .optional(),
      to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .or(z.literal(""))
        .optional(),
    })
    .parse(filters);
  const summary = await db.execute(
    sql`SELECT *,CASE WHEN quantity>0 THEN value/quantity ELSE NULL END AS average_rate FROM nova.stock_summary WHERE (${filter.item || null}::text IS NULL OR id=${filter.item || null}) ORDER BY name`,
  );
  const ledger = await db.execute(
    sql`SELECT m.*,d.category,d.reason,u.name AS actor,i.name AS item FROM nova.inventory_movements m JOIN nova.stock_documents d ON d.id=m.document_id JOIN nova.users u ON u.id=m.actor_id JOIN nova.inventory_items i ON i.id=m.item_id WHERE (${filter.item || null}::text IS NULL OR m.item_id=${filter.item || null}) AND (${filter.category || null}::text IS NULL OR d.category=${filter.category || null}) AND (${filter.from || null}::date IS NULL OR m.posted_at >= ${filter.from || null}::date) AND (${filter.to || null}::date IS NULL OR m.posted_at < ${filter.to || null}::date + interval '1 day') ORDER BY m.posted_at DESC,m.id`,
  );
  const documents = await db.execute(
    sql`SELECT d.*,s.name AS supplier FROM nova.stock_documents d LEFT JOIN nova.suppliers s ON s.id=d.supplier_id ORDER BY d.created_at DESC`,
  );
  const lines = await db.execute(
    sql`SELECT l.*,i.name AS item FROM nova.stock_document_lines l JOIN nova.inventory_items i ON i.id=l.item_id ORDER BY l.id`,
  );
  return {
    summary: summary.rows,
    ledger: ledger.rows,
    documents: documents.rows,
    lines: lines.rows,
  };
}
