import { assertRequestActive } from "../records/service";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "../catalog/service";
import { AccessError, type Actor } from "../auth/policy";
import { getBom } from "../catalog/bom";
import { convert, type Unit } from "../../lib/units/convert";
import { postDocument } from "../inventory/service";
import { ProductionDecimal as D, variance } from "./calculations";
const nonnegative = z.string().regex(/^\d{1,14}(\.\d{1,6})?$/);
const positive = nonnegative.refine((v) => new D(v).gt(0), "Must be positive");
const runInput = z
  .object({
    bomId: z.string().min(1),
    batches: positive,
    goodOutput: positive.refine(
      (v) => new D(v).isInteger(),
      "Packets must be whole",
    ),
    tolerance: nonnegative.refine((v) => new D(v).lte(100)),
    requestKey: z.string().min(8).max(100),
    inputs: z
      .array(
        z
          .object({
            itemId: z.string(),
            actual: positive,
            damaged: nonnegative,
            unit: z.enum(["g", "kg", "ml", "L", "piece"]),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export function productionAccess(actor: Actor | null, write = false) {
  if (!actor) throw new AccessError(401, "Please sign in.");
  if (
    actor.role === "salesman" ||
    (write && !["admin", "production"].includes(actor.role))
  )
    throw new AccessError(403, "Production operation is not permitted.");
  return actor;
}
export async function createRun(
  db: Database,
  actor: Actor | null,
  input: unknown,
  editId?: string,
) {
  const user = productionAccess(actor, true);
  const data = runInput.parse(input);
  return db.transaction(async (tx) => {
    await assertRequestActive(tx, "stock", data.requestKey);
    const existing = await tx.execute(
      sql`SELECT id FROM nova.stock_documents WHERE request_key=${data.requestKey} AND payload=${JSON.stringify(data)}::jsonb AND created_by=${user.id}`,
    );
    if (existing.rows.length && !editId) return String(existing.rows[0].id);
    let before: unknown = null;
    if (editId) {
      const row = (
        await tx.execute(
          sql`SELECT * FROM nova.stock_documents WHERE id=${editId} FOR UPDATE`,
        )
      ).rows[0];
      if (!row || row.category !== "production")
        throw new AccessError(404, "Run not found.");
      if (row.status !== "draft")
        throw new AccessError(409, "Posted production is immutable.");
      if (row.request_key !== data.requestKey)
        throw new AccessError(409, "Run key cannot change.");
      before = row.payload;
      await tx.execute(
        sql`DELETE FROM nova.production_inputs WHERE run_id=${editId}`,
      );
      await tx.execute(
        sql`DELETE FROM nova.stock_document_lines WHERE document_id=${editId}`,
      );
      await tx.execute(
        sql`UPDATE nova.stock_documents SET payload=${JSON.stringify(data)}::jsonb WHERE id=${editId}`,
      );
    }
    const bom = await getBom(tx, user, data.bomId);
    if (!bom.publishedAt) throw new AccessError(422, "Select a published BOM.");
    if (
      data.inputs.length !== bom.lines.length ||
      new Set(data.inputs.map((i) => i.itemId)).size !== data.inputs.length
    )
      throw new AccessError(422, "Enter every BOM component exactly once.");
    const factor = new D(data.batches).div(bom.batchSize);
    const planned = bom.lines.map((l) => {
      const actual = data.inputs.find((i) => i.itemId === l.itemId);
      if (!actual) throw new AccessError(422, "Missing BOM component.");
      let consumed: string, damaged: string;
      try {
        consumed = convert(actual.actual, actual.unit, l.unit as Unit);
        damaged = convert(actual.damaged, actual.unit, l.unit as Unit);
      } catch {
        throw new AccessError(422, "Incompatible material unit.");
      }
      if (new D(damaged).gt(consumed))
        throw new AccessError(
          422,
          "Damage is part of total consumption and cannot exceed it.",
        );
      if (
        l.unit === "piece" &&
        (!new D(consumed).isInteger() || !new D(damaged).isInteger())
      )
        throw new AccessError(422, "Packaging counts must be whole.");
      return {
        ...l,
        planned: new D(l.quantity).mul(factor).toFixed(),
        actual: consumed,
        damaged,
        ...variance(
          consumed,
          new D(l.quantity).mul(factor).toFixed(),
          data.tolerance,
        ),
      };
    });
    const expected = new D(bom.expectedOutput).mul(factor).toFixed();
    const snapshot = {
      bomId: bom.id,
      revision: bom.revision,
      productId: bom.productId,
      batchSize: bom.batchSize,
      batches: data.batches,
      expectedOutput: expected,
      goodOutput: data.goodOutput,
      tolerance: data.tolerance,
      yield: variance(data.goodOutput, expected, data.tolerance),
      lines: planned,
    };
    const id = editId ?? randomUUID();
    if (!editId) {
      const inserted = await tx.execute(
        sql`INSERT INTO nova.stock_documents(id,category,reason,request_key,payload,created_by) VALUES(${id},'production','Production run',${data.requestKey},${JSON.stringify(data)}::jsonb,${user.id}) ON CONFLICT(request_key) DO NOTHING RETURNING id`,
      );
      if (!inserted.rows.length) {
        const repeated = await tx.execute(
          sql`SELECT id FROM nova.stock_documents WHERE request_key=${data.requestKey} AND payload=${JSON.stringify(data)}::jsonb AND created_by=${user.id}`,
        );
        if (!repeated.rows.length)
          throw new AccessError(409, "Request key already used.");
        return String(repeated.rows[0].id);
      }
    }
    await tx.execute(
      sql`INSERT INTO nova.production_runs(id,bom_id,product_id,batches,expected_output,good_output,tolerance,snapshot) VALUES(${id},${bom.id},${bom.productId},${data.batches}::numeric,${expected}::numeric,${data.goodOutput}::numeric,${data.tolerance}::numeric,${JSON.stringify(snapshot)}::jsonb) ON CONFLICT(id) DO UPDATE SET bom_id=excluded.bom_id,product_id=excluded.product_id,batches=excluded.batches,expected_output=excluded.expected_output,good_output=excluded.good_output,tolerance=excluded.tolerance,snapshot=excluded.snapshot`,
    );
    for (const line of planned) {
      const lineId = randomUUID();
      await tx.execute(
        sql`INSERT INTO nova.stock_document_lines(id,document_id,item_id,quantity,unit) VALUES(${lineId},${id},${line.itemId},${new D(line.actual).neg().toFixed()}::numeric,${line.unit})`,
      );
      await tx.execute(
        sql`INSERT INTO nova.production_inputs(line_id,run_id,item_id,planned_quantity,actual_quantity,damaged_quantity,unit) VALUES(${lineId},${id},${line.itemId},${line.planned}::numeric,${line.actual}::numeric,${line.damaged}::numeric,${line.unit})`,
      );
    }
    await tx.execute(
      sql`INSERT INTO nova.stock_document_lines(id,document_id,item_id,quantity,unit) SELECT ${randomUUID()},${id},item_id,${data.goodOutput}::numeric,'packet' FROM nova.products WHERE id=${bom.productId}`,
    );
    await tx.execute(
      sql`INSERT INTO nova.audit_events(id,actor_id,action,document_id,before,after) VALUES(${randomUUID()},${user.id},${editId ? "production.edit" : "production.draft"},${id},${JSON.stringify(before)}::jsonb,${JSON.stringify(snapshot)}::jsonb)`,
    );
    return id;
  });
}
export async function postRun(db: Database, actor: Actor | null, id: string) {
  productionAccess(actor, true);
  const run = await db.execute(
    sql`SELECT id FROM nova.production_runs WHERE id=${id}`,
  );
  if (!run.rows.length) throw new AccessError(404, "Production run not found.");
  return postDocument(db, actor, id);
}
export async function addOverhead(
  db: Database,
  actor: Actor | null,
  id: string,
  input: unknown,
) {
  const user = productionAccess(actor, true);
  const data = z
    .object({
      category: z.enum(["labour", "gas_power", "other"]),
      amount: z
        .string()
        .regex(/^\d{1,14}(\.\d{1,2})?$/)
        .refine((v) => new D(v).gt(0)),
      reason: z.string().trim().min(3).max(500),
      requestKey: z.string().min(8).max(100),
    })
    .strict()
    .parse(input);
  return db.transaction(async (tx) => {
    const run = await tx.execute(
      sql`SELECT id FROM nova.stock_documents WHERE id=${id} AND category='production' FOR UPDATE`,
    );
    if (!run.rows.length) throw new AccessError(404, "Run not found.");
    const before = (
      await tx.execute(sql`SELECT * FROM nova.production_costs WHERE id=${id}`)
    ).rows[0];
    const result = await tx.execute(
      sql`INSERT INTO nova.production_overheads(id,run_id,category,amount,reason,request_key,actor_id) VALUES(${randomUUID()},${id},${data.category},${data.amount}::numeric,${data.reason},${data.requestKey},${user.id}) ON CONFLICT(request_key) DO NOTHING RETURNING id`,
    );
    if (!result.rows.length) {
      const same = await tx.execute(
        sql`SELECT id FROM nova.production_overheads WHERE request_key=${data.requestKey} AND run_id=${id} AND category=${data.category} AND amount=${data.amount}::numeric AND reason=${data.reason} AND actor_id=${user.id}`,
      );
      if (!same.rows.length)
        throw new AccessError(409, "Overhead key already used.");
      return;
    }
    const after = (
      await tx.execute(sql`SELECT * FROM nova.production_costs WHERE id=${id}`)
    ).rows[0];
    await tx.execute(
      sql`INSERT INTO nova.audit_events(id,actor_id,action,document_id,before,after) VALUES(${randomUUID()},${user.id},'production.overhead',${id},${JSON.stringify(before)}::jsonb,${JSON.stringify({ cost: after, overhead: data })}::jsonb)`,
    );
  });
}
export async function listRuns(db: Database, actor: Actor | null) {
  productionAccess(actor);
  return (
    await db.execute(
      sql`SELECT r.*,d.status,d.posted_at,d.request_key,p.name AS product,c.material_cost,c.overheads,c.total_cost,c.cost_per_packet,s.inputs AS material_costs FROM nova.production_runs r JOIN nova.stock_documents d ON d.id=r.id JOIN nova.products p ON p.id=r.product_id LEFT JOIN nova.production_costs c ON c.id=r.id LEFT JOIN nova.production_cost_snapshots s ON s.run_id=r.id ORDER BY r.created_at DESC,r.id`,
    )
  ).rows;
}
export async function overheadHistory(db: Database, actor: Actor | null) {
  productionAccess(actor);
  return (
    await db.execute(
      sql`SELECT o.*,u.name AS actor FROM nova.production_overheads o JOIN nova.users u ON u.id=o.actor_id ORDER BY o.created_at`,
    )
  ).rows;
}
