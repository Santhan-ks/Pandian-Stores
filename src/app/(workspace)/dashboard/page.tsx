import Link from "next/link";
import { z } from "zod";
import { getDatabase } from "@/lib/db/connection";
import { currentActor } from "@/modules/auth/server";
import { getDashboard } from "@/modules/reporting/dashboard";
import { ReportTable } from "@/components/report-table";
import { Money as D } from "@/modules/billing/tax";
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
      <p className="page-description">
        A clear view of orders, stock and collections. All figures come from
        your posted records.
      </p>
      <div className="metric-grid">
        <Link
          prefetch={false}
          className="metric-card"
          href={link("orders", data.today)}
        >
          <span>Orders today</span>
          <strong>{data.submittedToday}</strong>
          <small>Submitted on the business date</small>
        </Link>
        <Link
          prefetch={false}
          className="metric-card"
          href={link("orders", "0001-01-01")}
        >
          <span>Awaiting approval</span>
          <strong>{data.pendingApprovals}</strong>
          <small>Orders ready for admin review</small>
        </Link>
        <Link prefetch={false} className="metric-card" href={link("sales")}>
          <span>Invoiced this month</span>
          <strong>
            INR {new D(data.sales.totals.total ?? "0").toFixed(2)}
          </strong>
          <small>
            {scope === "demo" ? "Demonstration invoices" : "Real invoices only"}
          </small>
        </Link>
        <Link
          prefetch={false}
          className="metric-card"
          href={link("customer_balances")}
        >
          <span>Customer outstanding</span>
          <strong>
            INR {new D(data.receivables.totals.outstanding ?? "0").toFixed(2)}
          </strong>
          <small>Receivables as of today</small>
        </Link>
      </div>
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
          <Link prefetch={false} href={link("orders", data.today)}>
            Orders submitted today: {data.submittedToday}
          </Link>
        </p>
        <p>
          <Link prefetch={false} href={link("orders", "0001-01-01")}>
            Pending approvals: {data.pendingApprovals}
          </Link>
        </p>
      </section>
      <section>
        <h2>Month invoiced sales (gross)</h2>
        <p>INR {data.sales.totals.total}</p>
        <Link prefetch={false} href={link("sales")}>
          Sales register
        </Link>
        {" · "}
        <Link prefetch={false} href={link("gst")}>
          GST and credit review
        </Link>
      </section>
      <section>
        <h2>Finished-goods stock</h2>
        <Link prefetch={false} href={link("stock")}>
          Stock detail
        </Link>
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
        <Link prefetch={false} href={link("production")}>
          Production register
        </Link>
        <ReportTable report={data.production} />
      </section>
      <section>
        <h2>Customer outstanding as of today</h2>
        <Link prefetch={false} href={link("customer_balances")}>
          Receivables detail
        </Link>
        <ReportTable report={data.receivables} />
      </section>
    </>
  );
}

export const metadata = { title: "Owner dashboard" };
