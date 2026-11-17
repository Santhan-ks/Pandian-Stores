import { getDatabase } from "@/lib/db/connection";
import { currentActor } from "@/modules/auth/server";
import { checkOrigin, errorResponse } from "@/modules/catalog/http";
import {
  listSales,
  submitOrder,
  reviewOrder,
  issueInvoice,
  issueDemoInvoice,
  dispatchOrder,
  creditInvoice,
} from "@/modules/sales/service";
import { recordPayment } from "@/modules/payments/service";
import { invoicePdf } from "@/modules/billing/pdf";
export async function GET(request: Request) {
  try {
    const result = await listSales(
      getDatabase(),
      await currentActor(request.headers),
    );
    const id = new URL(request.url).searchParams.get("pdf");
    if (id) {
      const invoice = result.orders.find((o) => o.invoice_id === id);
      if (!invoice)
        return Response.json({ error: "Invoice not found" }, { status: 404 });
      return new Response(
        new Uint8Array(
          invoicePdf({
            ...(invoice.snapshot as Record<string, unknown>),
            mode: invoice.issuance_mode,
          }),
        ),
        {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": 'attachment; filename="invoice.pdf"',
            "Cache-Control": "no-store",
          },
        },
      );
    }
    return Response.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const actor = await currentActor(request.headers);
    const db = getDatabase();
    const p = new URL(request.url).searchParams;
    const body = await request.json();
    let result;
    if (p.has("review"))
      result = await reviewOrder(db, actor, p.get("review")!, body);
    else if (p.has("demoInvoice"))
      result = await issueDemoInvoice(db, actor, p.get("demoInvoice")!, body);
    else if (p.has("invoice"))
      result = await issueInvoice(db, actor, p.get("invoice")!, body);
    else if (p.has("dispatch"))
      result = await dispatchOrder(db, actor, p.get("dispatch")!);
    else if (p.has("credit"))
      result = await creditInvoice(db, actor, p.get("credit")!, body.reason);
    else if (p.has("payment")) result = await recordPayment(db, actor, body);
    else result = await submitOrder(db, actor, body);
    return Response.json({ id: result ?? null });
  } catch (e) {
    return errorResponse(e);
  }
}
