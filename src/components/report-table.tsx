"use client";
import { useState } from "react";
import type { Report } from "@/modules/reporting/types";
import { displayCell } from "@/modules/reporting/format";
export function ReportTable({ report }: { report: Report }) {
  const [page, setPage] = useState(0);
  const last = Math.max(0, Math.ceil(report.rows.length / 50) - 1),
    current = Math.min(page, last);
  const rows = report.rows.slice(current * 50, current * 50 + 50);
  return (
    <>
      <div
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Scrollable data table"
      >
        {report.rows.length ? (
          <table>
            <thead>
              <tr>
                {report.columns.map((c) => (
                  <th key={c.key} scope="col">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {report.columns.map((c) => (
                    <td key={c.key}>{displayCell(r[c.key], c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>No records for the selected filters.</p>
        )}
      </div>
      {report.rows.length > 50 && (
        <nav aria-label="Report pages">
          <button disabled={current === 0} onClick={() => setPage(current - 1)}>
            Previous page
          </button>
          <span role="status">
            Page {current + 1} of {last + 1}; {report.rows.length} records.
            Totals cover every record.
          </span>
          <button
            disabled={current === last}
            onClick={() => setPage(current + 1)}
          >
            Next page
          </button>
        </nav>
      )}
      {Object.keys(report.totals).length > 0 && (
        <dl>
          {report.columns
            .filter((c) => c.total)
            .map((c) => (
              <div key={c.key}>
                <dt>{c.label} total</dt>
                <dd>{displayCell(report.totals[c.key], c)}</dd>
              </div>
            ))}
        </dl>
      )}
    </>
  );
}
