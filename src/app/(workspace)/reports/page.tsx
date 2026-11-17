import Link from "next/link";
import { z } from "zod";
import { currentActor } from "@/modules/auth/server";
import { getDatabase } from "@/lib/db/connection";
import { defaultFilters, getReport } from "@/modules/reporting/service";
import { kinds, reportAccess, reportNames } from "@/modules/reporting/types";
import { ReportTable } from "@/components/report-table";
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await currentActor();
  const params = await searchParams;
  const available = kinds.filter((k) => {
    try {
      reportAccess(actor, k);
      return true;
    } catch {
      return false;
    }
  });
  const kind = z.enum(kinds).parse(params.kind ?? available[0]);
  reportAccess(actor, kind);
  const input = Object.fromEntries(
    Object.entries(params).filter(
      ([k, v]) => k !== "kind" && typeof v === "string",
    ),
  );
  let report;
  try {
    report = await getReport(
      getDatabase(),
      actor,
      kind,
      await defaultFilters(getDatabase(), input),
    );
  } catch (e) {
    if (e instanceof z.ZodError)
      return (
        <>
          <h1>Reports</h1>
          <p role="alert">
            Invalid report filters: {e.issues.map((i) => i.message).join("; ")}
          </p>
          <Link href="/reports">Reset filters</Link>
        </>
      );
    throw e;
  }
  const f = report.filters;
  const query = new URLSearchParams({ kind, ...f });
  return (
    <>
      <h1>Reports</h1>
      <form method="get">
        <div className="fields">
          <label>
            Report
            <select name="kind" defaultValue={kind}>
              {available.map((k) => (
                <option key={k} value={k}>
                  {reportNames[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Invoice scope
            <select name="scope" defaultValue={f.scope}>
              <option value="real">Real tax invoices only</option>
              <option value="demo">Demonstration benchmark only</option>
            </select>
          </label>
          <label>
            From (inclusive)
            <input type="date" name="from" defaultValue={f.from} required />
          </label>
          <label>
            To (inclusive)
            <input type="date" name="to" defaultValue={f.to} required />
          </label>
          <label>
            As of (inclusive)
            <input type="date" name="asOf" defaultValue={f.asOf} required />
          </label>
          <label>
            Customer ID
            <input name="customer" defaultValue={f.customer} />
          </label>
          <label>
            Product ID
            <input name="product" defaultValue={f.product} />
          </label>
          <label>
            Salesman ID
            <input name="salesman" defaultValue={f.salesman} />
          </label>
          <label>
            Inventory item ID
            <input name="item" defaultValue={f.item} />
          </label>
          <label>
            Invoice status as of
            <select name="status" defaultValue={f.status}>
              <option value="all">All</option>
              <option value="posted">Posted, not credited</option>
              <option value="credited">Credited</option>
            </select>
          </label>
        </div>
        <button>Run report</button>
      </form>
      <h2>{report.title}</h2>
      <p>{report.notes[0]}</p>
      <p>
        {f.from} through {f.to}; as of {f.asOf}. Asia/Kolkata. Currency INR.
      </p>
      <p>
        <a href={"/api/reports?" + query + "&format=csv"}>Download CSV</a>
        {" · "}
        <a href={"/api/reports?" + query + "&format=pdf"}>Download PDF</a>
      </p>
      <ReportTable report={report} />
      <h2>Definitions</h2>
      <ul>
        {report.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </>
  );
}
