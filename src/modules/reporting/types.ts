import { z } from "zod";
import { AccessError, type Actor } from "../auth/policy";
export const reportNames = {
  sales: "Sales register",
  customer_sales: "Customer sales",
  product_sales: "Product sales",
  gst: "Outward GST review",
  purchases: "Purchase register",
  stock: "Stock summary / historical stock",
  ledger: "Stock ledger",
  production: "Production register",
  consumption: "Production consumption and variance",
  payments: "Payment register",
  receivables: "Invoice collections and receivables",
  customer_balances: "Customer outstanding",
  ageing: "Receivables ageing",
  orders: "Order register",
} as const;
export type ReportKind = keyof typeof reportNames;
export const kinds = Object.keys(reportNames) as ReportKind[];
export function reportAccess(actor: Actor | null, kind: ReportKind) {
  if (!actor) throw new AccessError(401, "Please sign in.");
  const permitted =
    actor.role === "production"
      ? ["stock", "ledger", "production", "consumption"]
      : actor.role === "salesman"
        ? [
            "sales",
            "customer_sales",
            "product_sales",
            "receivables",
            "customer_balances",
            "ageing",
            "orders",
          ]
        : kinds;
  if (!permitted.includes(kind))
    throw new AccessError(403, "Report access is not permitted.");
  return actor;
}
export const filtersSchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    asOf: z.iso.date(),
    scope: z.enum(["real", "demo"]).default("real"),
    customer: z.string().max(100).default(""),
    product: z.string().max(100).default(""),
    salesman: z.string().max(100).default(""),
    item: z.string().max(100).default(""),
    status: z.enum(["all", "posted", "credited"]).default("all"),
  })
  .strict()
  .refine(
    (f) => f.from <= f.to && f.to <= f.asOf,
    "Dates must satisfy from <= to <= as-of.",
  );
export type Filters = z.infer<typeof filtersSchema>;
export type Column = {
  key: string;
  label: string;
  type?: "money" | "number";
  total?: boolean;
};
export type Row = Record<string, string | null>;
export type Report = {
  kind: ReportKind;
  title: string;
  filters: Filters;
  timezone: "Asia/Kolkata";
  generatedAt: string;
  columns: Column[];
  rows: Row[];
  totals: Row;
  notes: string[];
};
const t = (key: string, label: string): Column => ({ key, label });
const n = (key: string, label: string, total = false): Column => ({
  key,
  label,
  type: "number",
  total,
});
const m = (key: string, label: string, total = true): Column => ({
  key,
  label: `${label} (INR)`,
  type: "money",
  total,
});
export const columns: Record<ReportKind, Column[]> = {
  sales: [
    t("invoice_id", "Invoice ID"),
    t("number", "Invoice number"),
    t("date", "Invoice date"),
    t("customer", "Customer snapshot"),
    t("salesman", "Salesman"),
    t("status", "Status as of"),
    t("scope", "Scope"),
    n("quantity", "Packets", true),
    m("taxable", "Taxable"),
    m("cgst", "CGST"),
    m("sgst", "SGST"),
    m("igst", "IGST"),
    m("total", "Selected line total"),
    m("invoice_total", "Whole invoice total", false),
  ],
  customer_sales: [
    t("customer_id", "Customer ID"),
    t("customer", "Customer snapshot"),
    n("invoices", "Invoices"),
    n("quantity", "Packets", true),
    m("taxable", "Taxable"),
    m("cgst", "CGST"),
    m("sgst", "SGST"),
    m("igst", "IGST"),
    m("total", "Invoiced total"),
  ],
  product_sales: [
    t("product_id", "Product ID"),
    t("product", "Product snapshot"),
    n("invoices", "Invoices"),
    n("quantity", "Packets", true),
    m("taxable", "Taxable"),
    m("cgst", "CGST"),
    m("sgst", "SGST"),
    m("igst", "IGST"),
    m("total", "Invoiced total"),
  ],
  gst: [
    t("treatment", "Supply treatment"),
    n("gst_percent", "GST rate %"),
    t("event", "Invoice / full credit"),
    m("taxable", "Signed taxable"),
    m("cgst", "Signed CGST"),
    m("sgst", "Signed SGST"),
    m("igst", "Signed IGST"),
    m("total", "Signed total"),
  ],
  purchases: [
    t("document_id", "Purchase document number"),
    t("date", "Posting / draft creation date"),
    t("supplier", "Supplier"),
    t("item", "Item"),
    n("quantity", "Quantity"),
    t("unit", "Entered unit"),
    n("unit_rate", "Rate per entered unit (INR)"),
    m("amount", "Line value"),
    t("status", "Posting status"),
  ],
  stock: [
    t("item_id", "Item ID"),
    t("item", "Item"),
    t("kind", "Kind"),
    t("unit", "Base unit"),
    n("opening", "Opening before from"),
    n("receipts", "Receipts"),
    n("issues", "Issues"),
    n("adjustments", "Signed adjustments"),
    n("closing", "Closing as of"),
    m("known_value", "Known movement subtotal", false),
    m("value", "Inventory value", false),
    t("valuation", "Valuation status"),
  ],
  ledger: [
    t("movement_id", "Movement ID"),
    t("item", "Item"),
    t("unit", "Base unit"),
    t("posted_at", "Posting time (Asia/Kolkata)"),
    t("document_id", "Source stock document"),
    t("category", "Source category"),
    t("source_id", "Invoice / production / purchase ID"),
    t("actor", "Actor"),
    n("opening", "Period opening"),
    n("quantity", "Signed movement"),
    n("balance", "Balance after movement"),
    m("value", "Signed movement value", false),
    t("valuation", "Valuation status"),
  ],
  production: [
    t("run_id", "Run / stock document ID"),
    t("date", "Posting time (Asia/Kolkata)"),
    t("product", "Product (current master)"),
    n("revision", "BOM revision"),
    n("expected", "Expected packets", true),
    n("good", "Good packets", true),
    n("yield_variance", "Yield variance %"),
    t("alert", "Yield alert"),
    m("material_cost", "Material cost"),
    m("labour", "Labour"),
    m("utilities", "Gas/power"),
    m("other", "Other overheads"),
    m("total_cost", "Run cost as of"),
    m("cost_per_packet", "Cost per good packet", false),
  ],
  consumption: [
    t("run_id", "Run ID"),
    t("item", "Item snapshot"),
    t("kind", "Material kind"),
    t("unit", "Consumption unit"),
    n("planned", "Planned"),
    n("actual", "Actual including waste"),
    n("waste", "Included waste"),
    n("variance", "Consumption variance %"),
    t("alert", "Variance alert"),
    m("cost", "Posted material issue cost"),
  ],
  payments: [
    t("payment_id", "Payment ID"),
    t("date", "Payment date"),
    t("customer", "Customer"),
    t("reference", "Reference"),
    t("method", "Method"),
    t("scope", "Invoice scope"),
    m("amount", "Allocated collections in scope"),
    m("payment_amount", "Whole payment amount", false),
    t("invoice_numbers", "Allocated invoices"),
  ],
  receivables: [
    t("invoice_id", "Invoice ID"),
    t("number", "Invoice"),
    t("date", "Invoice date"),
    t("customer", "Customer snapshot"),
    t("status", "Status as of"),
    m("total", "Whole invoice total"),
    m("collected", "Allocated collections as of"),
    m("credited", "Full credits as of"),
    m("outstanding", "Outstanding as of"),
    n("age_days", "Days since invoice"),
  ],
  customer_balances: [
    t("customer_id", "Customer ID"),
    t("customer", "Customer snapshot"),
    m("total", "Invoiced as of"),
    m("collected", "Collections as of"),
    m("credited", "Credits as of"),
    m("outstanding", "Outstanding as of"),
  ],
  ageing: [
    t("customer_id", "Customer ID"),
    t("customer", "Customer snapshot"),
    m("age_0_30", "0-30 days since invoice"),
    m("age_31_60", "31-60 days since invoice"),
    m("age_61_90", "61-90 days since invoice"),
    m("age_91_plus", "91+ days since invoice"),
    m("outstanding", "Outstanding as of"),
  ],
  orders: [
    t("order_id", "Order ID"),
    t("date", "Submitted time (Asia/Kolkata)"),
    t("customer", "Customer"),
    t("salesman", "Salesman"),
    t("status", "Current status"),
    n("quantity", "Packets", true),
    t("invoice_id", "Invoice ID"),
  ],
};
