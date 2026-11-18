import { sql } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { AccessError, canDelete, type Actor } from "../auth/policy";
import type { Database } from "../catalog/service";

const tables = {
  users: "users",
  customers: "customers",
  territories: "territories",
  suppliers: "suppliers",
  materials: "inventory_items",
  products: "products",
  prices: "product_prices",
  stock: "stock_documents",
  production: "stock_documents",
  orders: "sales_orders",
} as const;
const protectedResources = [
  "boms",
  "invoices",
  "payments",
  "ledger",
  "credits",
  "overheads",
  "audit",
];
type Executor = Pick<Database, "execute">;

export async function lockUserManagement(db: Executor) {
  await db.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended('nova-user-management',0))`,
  );
}

async function lockRequest(
  db: Executor,
  scope: "stock" | "orders",
  key: string,
) {
  await db.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${scope + ":" + key},0))`,
  );
}

export async function assertRequestActive(
  db: Executor,
  scope: "stock" | "orders",
  key: string,
) {
  await lockRequest(db, scope, key);
  if (
    (
      await db.execute(
        sql`SELECT 1 FROM nova.deleted_records WHERE request_scope=${scope} AND request_key=${key}`,
      )
    ).rows.length
  )
    throw new AccessError(
      410,
      "This request belongs to a deleted record. Start a new document.",
    );
}

export async function deleteRecord(
  db: Database,
  actor: Actor | null,
  resource: string,
  inputId: unknown,
) {
  if (!actor) throw new AccessError(401, "Please sign in.");
  if (!canDelete(actor.role))
    throw new AccessError(
      403,
      "Only admins and owners may delete eligible records.",
    );
  const id = z.string().min(1).max(100).parse(inputId);
  if (protectedResources.includes(resource))
    throw new AccessError(
      409,
      "Posted financial, ledger, audit and published BOM history cannot be deleted. Use the correction workflow.",
    );
  if (!Object.hasOwn(tables, resource))
    throw new AccessError(404, "Unknown record type.");
  const table = sql.raw("nova." + tables[resource as keyof typeof tables]);
  try {
    return await db.transaction(async (tx) => {
      if (resource === "users") await lockUserManagement(tx);
      const actualRole = (
        await tx.execute(
          sql`SELECT role FROM nova.user_roles WHERE user_id=${actor.id} FOR SHARE`,
        )
      ).rows[0]?.role;
      if (actualRole !== "admin" && actualRole !== "owner")
        throw new AccessError(403, "Delete permission is no longer assigned.");
      const scope =
        resource === "orders"
          ? "orders"
          : ["stock", "production"].includes(resource)
            ? "stock"
            : null;
      if (scope) {
        const peek = (
          await tx.execute(sql`SELECT request_key FROM ${table} WHERE id=${id}`)
        ).rows[0];
        if (peek) await lockRequest(tx, scope, String(peek.request_key));
      }
      const before = (
        await tx.execute(sql`SELECT * FROM ${table} WHERE id=${id} FOR UPDATE`)
      ).rows[0];
      if (!before) {
        const deleted = (
          await tx.execute(
            sql`SELECT 1 FROM nova.deleted_records WHERE resource=${resource} AND record_id=${id}`,
          )
        ).rows.length;
        if (deleted) return { id, alreadyDeleted: true };
        throw new AccessError(404, "Record not found.");
      }
      if (resource === "materials" && before.kind === "finished")
        throw new AccessError(
          409,
          "Delete an unused finished product through Products.",
        );
      if (scope === "stock") {
        if (before.status !== "draft")
          throw new AccessError(
            409,
            "Posted stock records are immutable. Create a reasoned correction instead.",
          );
        if (
          resource === "production"
            ? before.category !== "production"
            : !["opening", "purchase", "adjustment"].includes(
                String(before.category),
              )
        )
          throw new AccessError(
            409,
            "Use the matching source workflow for this document.",
          );
        if (resource === "production") {
          if (
            (
              await tx.execute(
                sql`SELECT 1 FROM nova.production_overheads WHERE run_id=${id}`,
              )
            ).rows.length
          )
            throw new AccessError(
              409,
              "A run with recorded overheads is accounting history and cannot be deleted.",
            );
          await tx.execute(
            sql`DELETE FROM nova.production_inputs WHERE run_id=${id}`,
          );
          await tx.execute(
            sql`DELETE FROM nova.production_runs WHERE id=${id}`,
          );
        }
        await tx.execute(
          sql`DELETE FROM nova.stock_document_lines WHERE document_id=${id}`,
        );
      }
      if (resource === "orders") {
        if (before.status !== "submitted")
          throw new AccessError(
            409,
            "Reviewed or invoiced orders are history and cannot be deleted.",
          );
        await tx.execute(
          sql`DELETE FROM nova.sales_order_lines WHERE order_id=${id}`,
        );
      }
      if (resource === "users") {
        if (id === actor.id)
          throw new AccessError(409, "You cannot delete your own account.");
        const roles = (
          await tx.execute(
            sql`SELECT role FROM nova.user_roles WHERE user_id=${id}`,
          )
        ).rows;
        if (
          roles.some((r) => r.role === "admin") &&
          Number(
            (
              await tx.execute(
                sql`SELECT count(*)::int AS n FROM nova.user_roles WHERE role='admin'`,
              )
            ).rows[0].n,
          ) <= 1
        )
          throw new AccessError(
            409,
            "The last administrator cannot be deleted.",
          );
        before.role = roles[0]?.role;
        await tx.execute(sql`DELETE FROM nova.user_roles WHERE user_id=${id}`);
      }
      await tx.execute(sql`DELETE FROM ${table} WHERE id=${id}`);
      if (resource === "products")
        await tx.execute(
          sql`DELETE FROM nova.inventory_items WHERE id=${before.item_id}`,
        );
      await tx.execute(
        sql`INSERT INTO nova.deleted_records(resource,record_id,request_scope,request_key,deleted_by) VALUES(${resource},${id},${scope},${scope ? String(before.request_key) : null},${actor.id}) ON CONFLICT(resource,record_id) DO NOTHING`,
      );
      await tx.execute(
        sql`INSERT INTO nova.audit_events(id,actor_id,action,document_id,before,after) VALUES(${randomUUID()},${actor.id},${resource + ".delete"},${id},${JSON.stringify(before)}::jsonb,'{"deleted":true}'::jsonb)`,
      );
      return { id, alreadyDeleted: false };
    });
  } catch (error) {
    const cause = error instanceof Error ? (error.cause ?? error) : error;
    if ((cause as { code?: string })?.code === "23503")
      throw new AccessError(
        409,
        "This record is referenced by other records or history. Remove unused dependent setup first; posted history cannot be removed.",
      );
    throw error;
  }
}
