import type { Report, Column } from "./types";
import { Money as D } from "../billing/tax";
import { textPdf } from "../../lib/pdf/text";
export function displayCell(value: string | null, column: Column) {
  return value === null
    ? "Unavailable"
    : column.type === "money"
      ? new D(value).toFixed(2)
      : column.type === "number"
        ? new D(value).toFixed()
        : value;
}
function csvCell(value: string, numeric = false) {
  const safe =
    !numeric && /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? "'" + value : value;
  return '"' + safe.replace(/"/g, '""') + '"';
}
export function reportCsv(report: Report) {
  const metadata = [
    "Report",
    "From (inclusive)",
    "To (inclusive)",
    "As of (inclusive)",
    "Scope",
    "Timezone",
    "Definitions",
  ];
  const context = [
    report.title,
    report.filters.from,
    report.filters.to,
    report.filters.asOf,
    report.filters.scope,
    report.timezone,
    report.notes.join(" "),
  ];
  const header = [
    "Record type",
    ...report.columns.map((c) => c.label),
    ...metadata,
  ];
  const records = report.rows.map((row) => [
    "data",
    ...report.columns.map((c) => displayCell(row[c.key], c)),
    ...context,
  ]);
  if (!records.length)
    records.push(["empty", ...report.columns.map(() => ""), ...context]);
  if (Object.keys(report.totals).length)
    records.push([
      "totals",
      ...report.columns.map((c) =>
        c.total ? displayCell(report.totals[c.key], c) : "",
      ),
      ...context,
    ]);
  return (
    "\ufeff" +
    [
      header.map((v) => csvCell(v)).join(","),
      ...records.map((row) =>
        row
          .map((v, i) =>
            csvCell(
              v,
              i > 0 &&
                i <= report.columns.length &&
                !!report.columns[i - 1].type &&
                v !== "Unavailable",
            ),
          )
          .join(","),
      ),
    ].join("\r\n") +
    "\r\n"
  );
}
export function reportPdf(report: Report) {
  const header = [
    `NOVA - ${report.title}`,
    `${report.filters.from} through ${report.filters.to}; as of ${report.filters.asOf}`,
    `Scope: ${report.filters.scope === "demo" ? "DEMONSTRATION ONLY - NOT STATUTORY SALES" : "Real invoices"}; ${report.timezone}; INR`,
  ];
  const rows: string[] = [];
  const append = (text: string) => {
    for (let i = 0; i < text.length; i += 90) rows.push(text.slice(i, i + 90));
  };
  if (!report.rows.length) rows.push("No records for the selected filters.");
  report.rows.forEach((row, i) => {
    rows.push(`Record ${i + 1}`);
    for (const c of report.columns)
      append(`${c.label}: ${displayCell(row[c.key], c)}`);
    rows.push("");
  });
  rows.push("Totals (only additive columns):");
  for (const c of report.columns.filter((c) => c.total))
    append(`${c.label}: ${displayCell(report.totals[c.key], c)}`);
  rows.push("Definitions and limitations:");
  report.notes.forEach(append);
  return textPdf(rows, header);
}
