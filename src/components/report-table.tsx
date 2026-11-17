import type { Report } from "@/modules/reporting/types";
import { displayCell } from "@/modules/reporting/exports";
export function ReportTable({ report }: { report: Report }) {
  return (
    <>
      <div className="table-scroll">
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
              {report.rows.map((r, i) => (
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
