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
    const orders = await reportInTransaction(tx, user, "orders", {
      ...f,
      from: "0001-01-01",
    });
    const sales = await reportInTransaction(tx, user, "sales", f),
      stock = await reportInTransaction(tx, user, "stock", f),
      production = await reportInTransaction(tx, user, "production", f),
      receivables = await reportInTransaction(tx, user, "customer_balances", f);
    return {
      today,
      scope,
      submittedToday: orders.rows.filter((r) => r.date?.slice(0, 10) === today)
        .length,
      pendingApprovals: orders.rows.filter((r) => r.status === "submitted")
        .length,
      sales,
      stock,
      production,
      receivables,
    };
  });
}
