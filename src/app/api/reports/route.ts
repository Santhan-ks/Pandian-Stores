import { z } from "zod";
import { getDatabase } from "@/lib/db/connection";
import { currentActor } from "@/modules/auth/server";
import { errorResponse } from "@/modules/catalog/http";
import { defaultFilters, getReport } from "@/modules/reporting/service";
import { kinds, reportAccess } from "@/modules/reporting/types";
import { reportCsv, reportPdf } from "@/modules/reporting/exports";
export async function GET(request: Request) {
  try {
    const params = Object.fromEntries(new URL(request.url).searchParams),
      kind = z.enum(kinds).parse(params.kind ?? "sales"),
      format = z.enum(["json", "csv", "pdf"]).parse(params.format ?? "json");
    const actor = reportAccess(await currentActor(request.headers), kind);
    delete params.kind;
    delete params.format;
    const report = await getReport(
      getDatabase(),
      actor,
      kind,
      await defaultFilters(getDatabase(), params),
    );
    if (format === "csv")
      return new Response(reportCsv(report), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="pandian-stores-${kind}-${report.filters.scope}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    if (format === "pdf")
      return new Response(new Uint8Array(reportPdf(report)), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="pandian-stores-${kind}-${report.filters.scope}.pdf"`,
          "Cache-Control": "no-store",
        },
      });
    return Response.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
