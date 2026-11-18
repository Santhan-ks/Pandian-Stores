import { sql } from "drizzle-orm";
import type { Database } from "../catalog/service";
import { AccessError, type Actor } from "../auth/policy";
import { businessToday, reportInTransaction } from "./service";
import type { Filters } from "./types";
export function dashboardAccess(actor: Actor | null) {
  if (!actor) throw new AccessError(401, "Please sign in.");
  if (!["owner", "admin", "auditor"].includes(actor.role))
    throw new AccessError(403, "Dashboard access is not permitted.");
  return actor;
}
export async function getDashboard(
  db: Database,
  actor: Actor | null,
  scope: "real" | "demo",
) {
  const user = dashboardAccess(actor);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`,
    );
    const today = await businessToday(tx);
    const f: Filters = {
      from: today.slice(0, 8) + "01",
      to: today,
      asOf: today,
      scope,
      customer: "",
      product: "",
      salesman: "",
      item: "",
      status: "all",
    };
    await tx.execute(sql`SET LOCAL statement_timeout='10s'`);
    const orderCounts = (
      await tx.execute(
        sql`SELECT count(*) FILTER(WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date=${today}::date)::text AS today,count(*) FILTER(WHERE status='submitted')::text AS pending FROM nova.sales_orders`,
      )
    ).rows[0];
    const sales = await reportInTransaction(tx, user, "sales", f),
      stock = await reportInTransaction(tx, user, "stock", f),
      production = await reportInTransaction(tx, user, "production", f),
      receivables = await reportInTransaction(tx, user, "customer_balances", f);
    return {
      today,
      scope,
      submittedToday: Number(orderCounts.today),
      pendingApprovals: Number(orderCounts.pending),
      sales,
      stock,
      production,
      receivables,
    };
  });
}
