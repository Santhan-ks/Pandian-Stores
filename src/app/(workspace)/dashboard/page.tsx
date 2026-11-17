import Link from "next/link";
import { z } from "zod";
import { getDatabase } from "@/lib/db/connection";
import { currentActor } from "@/modules/auth/server";
import { getDashboard } from "@/modules/reporting/dashboard";
import { ReportTable } from "@/components/report-table";
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const scope = z
    .enum(["real", "demo"])
    .parse((await searchParams).scope ?? "real");
  const data = await getDashboard(getDatabase(), await currentActor(), scope);
  const link = (kind: string, from = data.sales.filters.from) =>
    "/reports?" +
    new URLSearchParams({
      kind,
      scope,
      from,
      to: data.today,
      asOf: data.today,
    });
  return (
    <>
      <h1>Owner dashboard</h1>
      <form method="get">
        <label>
          Financial invoice scope
          <select name="scope" defaultValue={scope}>
            <option value="real">Real tax invoices only</option>
            <option value="demo">Demonstration benchmark only</option>
          </select>
        </label>
        <button>Apply scope</button>
      </form>
      <p>
        Business date {data.today}, Asia/Kolkata.{" "}
        {scope === "demo"
          ? "DEMONSTRATION ONLY — NOT STATUTORY SALES"
          : "Real invoice scope"}
        . Physical stock and submitted orders are shared operational records.
      </p>
      <section>
        <h2>Orders</h2>
        <p>
          <Link href={link("orders", data.today)}>
            Orders submitted today: {data.submittedToday}
          </Link>
        </p>
        <p>
          <Link href={link("orders", "0001-01-01")}>
            Pending approvals: {data.pendingApprovals}
          </Link>
        </p>
      </section>
      <section>
        <h2>Month invoiced sales (gross)</h2>
        <p>INR {data.sales.totals.total}</p>
        <Link href={link("sales")}>Sales register</Link>
        {" · "}
        <Link href={link("gst")}>GST and credit review</Link>
      </section>
      <section>
        <h2>Finished-goods stock</h2>
        <Link href={link("stock")}>Stock detail</Link>
        <ReportTable
          report={{
            ...data.stock,
            rows: data.stock.rows.filter((r) => r.kind === "finished"),
          }}
        />
      </section>
      <section>
        <h2>Raw-material stock</h2>
        <ReportTable
          report={{
            ...data.stock,
            rows: data.stock.rows.filter((r) => r.kind === "raw"),
          }}
        />
      </section>
      <section>
        <h2>Production yield alerts and cost per packet this month</h2>
        <p>
          Yield alerts:{" "}
          {data.production.rows.filter((r) => r.alert === "true").length}
        </p>
        <Link href={link("production")}>Production register</Link>
        <ReportTable report={data.production} />
      </section>
      <section>
        <h2>Customer outstanding as of today</h2>
        <Link href={link("customer_balances")}>Receivables detail</Link>
        <ReportTable report={data.receivables} />
      </section>
    </>
  );
}
