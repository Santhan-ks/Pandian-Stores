import { sql, type SQL } from "drizzle-orm";
import type { Database } from "../catalog/service";
import type { Actor } from "../auth/policy";
import { AccessError } from "../auth/policy";
import { Money as D } from "../billing/tax";
import {
  columns,
  filtersSchema,
  reportAccess,
  reportNames,
  type Filters,
  type Report,
  type ReportKind,
  type Row,
} from "./types";
const start = (date: string) =>
  sql`(${date}::date::timestamp AT TIME ZONE 'Asia/Kolkata')`;
const end = (date: string) =>
  sql`((${date}::date+1)::timestamp AT TIME ZONE 'Asia/Kolkata')`;
export async function businessToday(db: Database) {
  return String(
    (
      await db.execute(
        sql`SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS date`,
      )
    ).rows[0].date,
  );
}
export async function defaultFilters(
  db: Database,
  input: Record<string, unknown> = {},
) {
  const today = await businessToday(db);
  const to = typeof input.to === "string" ? input.to : today;
  return filtersSchema.parse({
    from: to.slice(0, 8) + "01",
    to,
    asOf: to,
    ...input,
  });
}
async function checkScope(db: Database, user: Actor, f: Filters) {
  if (user.role === "salesman") {
    if (f.salesman && f.salesman !== user.id)
      throw new AccessError(403, "Another salesman is outside your scope.");
    if (
      f.customer &&
      !(
        await db.execute(
          sql`SELECT c.id FROM nova.customers c JOIN nova.territories t ON t.id=c.territory_id WHERE c.id=${f.customer} AND t.salesman_id=${user.id}`,
        )
      ).rows.length
    )
      throw new AccessError(403, "Customer is outside your territory.");
  }
}
function invoiceLines(user: Actor, f: Filters) {
  return sql`
 WITH selected AS (
 SELECT i.id AS invoice_id,i.number,i.invoice_date,i.total AS invoice_total,i.issuance_mode AS scope,
 o.customer_id,o.salesman_id,u.name AS salesman,i.snapshot->'customer'->>'name' AS customer,
 x.line->>'productId' AS product_id,x.line->>'description' AS product,
 (x.line->>'gstPercent')::numeric AS gst_percent,(x.line->>'quantity')::numeric AS quantity,(x.line->>'taxable')::numeric AS taxable,
 (x.line->>'cgst')::numeric AS cgst,(x.line->>'sgst')::numeric AS sgst,(x.line->>'igst')::numeric AS igst,(x.line->>'total')::numeric AS total,
 CASE WHEN c.id IS NULL THEN 'posted' ELSE 'credited' END AS invoice_status,
 (c.created_at AT TIME ZONE 'Asia/Kolkata')::date AS credit_date,coalesce(c.amount,0) AS credit_amount,
 CASE WHEN lower(trim(i.snapshot->'seller'->>'state'))=lower(trim(i.snapshot->>'placeOfSupply')) THEN 'Intrastate' ELSE 'Interstate' END AS treatment
 FROM nova.invoices i JOIN nova.sales_orders o ON o.id=i.order_id JOIN nova.users u ON u.id=o.salesman_id
 JOIN nova.customers customer_master ON customer_master.id=o.customer_id JOIN nova.territories t ON t.id=customer_master.territory_id
 CROSS JOIN LATERAL jsonb_array_elements(i.snapshot->'lines') AS x(line)
 LEFT JOIN nova.credit_notes c ON c.invoice_id=i.id AND c.created_at<${end(f.asOf)}
 WHERE i.issuance_mode=${f.scope} AND i.invoice_date<=${f.asOf}::date
 AND (${user.role !== "salesman"} OR (o.salesman_id=${user.id} AND t.salesman_id=${user.id}))
 AND (${!f.customer} OR o.customer_id=${f.customer}) AND (${!f.salesman} OR o.salesman_id=${f.salesman})
 AND (${!f.product} OR x.line->>'productId'=${f.product})
 ), lines AS (SELECT * FROM selected WHERE ${f.status === "all"} OR invoice_status=${f.status})`;
}
function receivables(user: Actor, f: Filters) {
  return sql`${invoiceLines(user, f)}, balances AS (
 SELECT s.invoice_id,s.number,s.invoice_date,s.customer_id,s.customer,s.invoice_status,
 max(s.invoice_total) AS total,max(s.credit_amount) AS credited,
 coalesce((SELECT sum(a.amount) FROM nova.payment_allocations a JOIN nova.payments p ON p.id=a.payment_id WHERE a.invoice_id=s.invoice_id AND p.payment_date<=${f.asOf}::date),0) AS collected,
 ${f.asOf}::date-s.invoice_date AS age_days
 FROM lines s GROUP BY s.invoice_id,s.number,s.invoice_date,s.customer_id,s.customer,s.invoice_status
 ), receivables AS (SELECT *,total-collected-credited AS outstanding FROM balances)`;
}
async function query(user: Actor, kind: ReportKind, f: Filters): Promise<SQL> {
  const inPeriod = sql`invoice_date>=${f.from}::date AND invoice_date<=${f.to}::date`;
  switch (kind) {
    case "sales":
      return sql`${invoiceLines(user, f)} SELECT invoice_id,number,invoice_date::text AS date,customer,salesman,invoice_status AS status,scope,sum(quantity)::text AS quantity,sum(taxable)::text AS taxable,sum(cgst)::text AS cgst,sum(sgst)::text AS sgst,sum(igst)::text AS igst,sum(total)::text AS total,max(invoice_total)::text AS invoice_total FROM lines WHERE ${inPeriod} GROUP BY invoice_id,number,invoice_date,customer,salesman,invoice_status,scope ORDER BY invoice_date,number,invoice_id`;
    case "customer_sales":
    case "product_sales": {
      const group =
        kind === "customer_sales" ? sql`customer_id` : sql`product_id`;
      const label =
        kind === "customer_sales"
          ? sql`string_agg(DISTINCT customer,' / ' ORDER BY customer) AS customer`
          : sql`string_agg(DISTINCT product,' / ' ORDER BY product) AS product`;
      return sql`${invoiceLines(user, f)} SELECT ${group},${label},count(DISTINCT invoice_id)::text AS invoices,sum(quantity)::text AS quantity,sum(taxable)::text AS taxable,sum(cgst)::text AS cgst,sum(sgst)::text AS sgst,sum(igst)::text AS igst,sum(total)::text AS total FROM lines WHERE ${inPeriod} GROUP BY ${group} ORDER BY ${group}`;
    }
    case "gst":
      return sql`${invoiceLines(user, f)}, events AS (
 SELECT treatment,gst_percent,'Invoice'::text AS event,taxable,cgst,sgst,igst,total FROM lines WHERE ${inPeriod}
 UNION ALL SELECT treatment,gst_percent,'Full credit',-taxable,-cgst,-sgst,-igst,-total FROM lines WHERE credit_date>=${f.from}::date AND credit_date<=${f.to}::date)
 SELECT treatment,gst_percent::text,event,sum(taxable)::text AS taxable,sum(cgst)::text AS cgst,sum(sgst)::text AS sgst,sum(igst)::text AS igst,sum(total)::text AS total FROM events GROUP BY treatment,gst_percent,event ORDER BY treatment,gst_percent,event`;
    case "purchases":
      return sql`SELECT d.id AS document_id,to_char(coalesce(d.posted_at,d.created_at) AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD HH24:MI:SS') AS date,s.name AS supplier,i.name AS item,l.quantity::text,l.unit,l.unit_rate::text,(l.quantity*l.unit_rate)::text AS amount,d.status FROM nova.stock_documents d JOIN nova.stock_document_lines l ON l.document_id=d.id JOIN nova.inventory_items i ON i.id=l.item_id LEFT JOIN nova.suppliers s ON s.id=d.supplier_id WHERE d.category='purchase' AND coalesce(d.posted_at,d.created_at)>=${start(f.from)} AND coalesce(d.posted_at,d.created_at)<${end(f.to)} AND (${!f.item} OR i.id=${f.item}) ORDER BY coalesce(d.posted_at,d.created_at),d.id,l.id`;
    case "stock":
      return sql`WITH summary AS (
 SELECT i.id AS item_id,i.name AS item,i.kind,i.base_unit AS unit,
 coalesce(sum(m.quantity) FILTER(WHERE m.posted_at<${start(f.from)}),0) AS opening,
 coalesce(sum(m.quantity) FILTER(WHERE m.posted_at>=${start(f.from)} AND d.category<>'adjustment' AND m.quantity>0),0) AS receipts,
 -coalesce(sum(m.quantity) FILTER(WHERE m.posted_at>=${start(f.from)} AND d.category<>'adjustment' AND m.quantity<0),0) AS issues,
 coalesce(sum(m.quantity) FILTER(WHERE m.posted_at>=${start(f.from)} AND d.category='adjustment'),0) AS adjustments,
 coalesce(sum(m.quantity),0) AS closing,coalesce(sum(m.value),0) AS known_value,
 CASE WHEN coalesce(sum(m.quantity),0)=0 THEN 0 WHEN count(*) FILTER(WHERE m.id IS NOT NULL AND m.value IS NULL)>0 THEN NULL ELSE coalesce(sum(m.value),0) END AS value
 FROM nova.inventory_items i LEFT JOIN nova.inventory_movements m ON m.item_id=i.id AND m.posted_at<${end(f.asOf)} LEFT JOIN nova.stock_documents d ON d.id=m.document_id
 WHERE (${!f.item} OR i.id=${f.item}) GROUP BY i.id)
 SELECT item_id,item,kind,unit,opening::text,receipts::text,issues::text,adjustments::text,closing::text,known_value::text,value::text,CASE WHEN value IS NULL THEN 'Unknown (unvalued historical movements)' ELSE 'Known' END AS valuation FROM summary ORDER BY item,item_id`;
    case "ledger":
      return sql`WITH movement_history AS (
 SELECT m.*,sum(m.quantity) OVER(PARTITION BY m.item_id ORDER BY m.posted_at,m.id ROWS UNBOUNDED PRECEDING) AS running,
 coalesce(sum(m.quantity) FILTER(WHERE m.posted_at<${start(f.from)}) OVER(PARTITION BY m.item_id),0) AS opening FROM nova.inventory_movements m WHERE m.posted_at<${end(f.to)} AND (${!f.item} OR m.item_id=${f.item}))
 SELECT m.id AS movement_id,i.name AS item,m.base_unit AS unit,to_char(m.posted_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD HH24:MI:SS.US') AS posted_at,m.document_id,d.category,coalesce(x.invoice_id,r.id,d.id) AS source_id,u.name AS actor,m.opening::text,m.quantity::text,m.running::text AS balance,m.value::text,CASE WHEN m.value IS NULL THEN 'Unknown' ELSE 'Known' END AS valuation FROM movement_history m JOIN nova.stock_documents d ON d.id=m.document_id JOIN nova.inventory_items i ON i.id=m.item_id JOIN nova.users u ON u.id=m.actor_id LEFT JOIN nova.dispatches x ON x.id=d.id LEFT JOIN nova.production_runs r ON r.id=d.id WHERE m.posted_at>=${start(f.from)} ORDER BY i.name,m.posted_at,m.id`;
    case "production":
      return sql`SELECT r.id AS run_id,to_char(d.posted_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD HH24:MI:SS') AS date,p.name AS product,(r.snapshot->>'revision') AS revision,r.expected_output::text AS expected,r.good_output::text AS good,r.snapshot->'yield'->>'percent' AS yield_variance,r.snapshot->'yield'->>'flagged' AS alert,c.material_cost::text,
 coalesce(o.labour,0)::text AS labour,coalesce(o.utilities,0)::text AS utilities,coalesce(o.other,0)::text AS other,
 (c.total_cost-coalesce(future.amount,0))::text AS total_cost,((c.total_cost-coalesce(future.amount,0))/r.good_output)::text AS cost_per_packet
 FROM nova.production_runs r JOIN nova.stock_documents d ON d.id=r.id JOIN nova.products p ON p.id=r.product_id JOIN nova.production_costs c ON c.id=r.id
 LEFT JOIN LATERAL(SELECT sum(amount) FILTER(WHERE category='labour') AS labour,sum(amount) FILTER(WHERE category='gas_power') AS utilities,sum(amount) FILTER(WHERE category='other') AS other FROM nova.production_overheads WHERE run_id=r.id AND created_at<${end(f.asOf)}) o ON true
 LEFT JOIN LATERAL(SELECT sum(amount) AS amount FROM nova.production_overheads WHERE run_id=r.id AND created_at>=${end(f.asOf)}) future ON true
 WHERE d.status='posted' AND d.posted_at>=${start(f.from)} AND d.posted_at<${end(f.to)} AND (${!f.product} OR r.product_id=${f.product}) ORDER BY d.posted_at,r.id`;
    case "consumption":
      return sql`SELECT r.id AS run_id,coalesce(l.line->>'item',i.name) AS item,i.kind,l.line->>'unit' AS unit,l.line->>'planned' AS planned,l.line->>'actual' AS actual,l.line->>'damaged' AS waste,l.line->>'percent' AS variance,l.line->>'flagged' AS alert,(SELECT x->>'cost' FROM jsonb_array_elements(c.inputs) x WHERE x->>'itemId'=i.id) AS cost
 FROM nova.production_runs r JOIN nova.stock_documents d ON d.id=r.id CROSS JOIN LATERAL jsonb_array_elements(r.snapshot->'lines') l(line) JOIN nova.inventory_items i ON i.id=l.line->>'itemId' JOIN nova.production_cost_snapshots c ON c.run_id=r.id WHERE d.status='posted' AND d.posted_at>=${start(f.from)} AND d.posted_at<${end(f.to)} AND (${!f.product} OR r.product_id=${f.product}) AND (${!f.item} OR i.id=${f.item}) ORDER BY d.posted_at,r.id,i.name`;
    case "payments":
      return sql`${invoiceLines(user, f)}, eligible AS (SELECT DISTINCT invoice_id,number FROM lines)
 SELECT p.id AS payment_id,p.payment_date::text AS date,c.name AS customer,p.reference,p.method,${f.scope}::text AS scope,sum(a.amount)::text AS amount,max(p.amount)::text AS payment_amount,string_agg(e.number,', ' ORDER BY e.number) AS invoice_numbers FROM nova.payments p JOIN nova.payment_allocations a ON a.payment_id=p.id JOIN eligible e ON e.invoice_id=a.invoice_id JOIN nova.customers c ON c.id=p.customer_id WHERE p.payment_date>=${f.from}::date AND p.payment_date<=${f.to}::date GROUP BY p.id,c.name ORDER BY p.payment_date,p.id`;
    case "receivables":
      return sql`${receivables(user, f)} SELECT invoice_id,number,invoice_date::text AS date,customer,invoice_status AS status,total::text,collected::text,credited::text,outstanding::text,age_days::text FROM receivables ORDER BY invoice_date,number,invoice_id`;
    case "customer_balances":
      return sql`${receivables(user, f)} SELECT customer_id,string_agg(DISTINCT customer,' / ' ORDER BY customer) AS customer,sum(total)::text AS total,sum(collected)::text AS collected,sum(credited)::text AS credited,sum(outstanding)::text AS outstanding FROM receivables GROUP BY customer_id ORDER BY customer_id`;
    case "ageing":
      return sql`${receivables(user, f)} SELECT customer_id,string_agg(DISTINCT customer,' / ' ORDER BY customer) AS customer,coalesce(sum(outstanding) FILTER(WHERE age_days BETWEEN 0 AND 30),0)::text AS age_0_30,coalesce(sum(outstanding) FILTER(WHERE age_days BETWEEN 31 AND 60),0)::text AS age_31_60,coalesce(sum(outstanding) FILTER(WHERE age_days BETWEEN 61 AND 90),0)::text AS age_61_90,coalesce(sum(outstanding) FILTER(WHERE age_days>90),0)::text AS age_91_plus,sum(outstanding)::text AS outstanding FROM receivables WHERE outstanding>0 GROUP BY customer_id ORDER BY customer_id`;
    case "orders":
      return sql`SELECT o.id AS order_id,to_char(o.created_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD HH24:MI:SS') AS date,c.name AS customer,u.name AS salesman,o.status,sum(l.quantity)::text AS quantity,i.id AS invoice_id FROM nova.sales_orders o JOIN nova.customers c ON c.id=o.customer_id JOIN nova.territories t ON t.id=c.territory_id JOIN nova.users u ON u.id=o.salesman_id JOIN nova.sales_order_lines l ON l.order_id=o.id LEFT JOIN nova.invoices i ON i.order_id=o.id WHERE o.created_at>=${start(f.from)} AND o.created_at<${end(f.to)} AND (${user.role !== "salesman"} OR (o.salesman_id=${user.id} AND t.salesman_id=${user.id})) AND (${!f.customer} OR o.customer_id=${f.customer}) AND (${!f.salesman} OR o.salesman_id=${f.salesman}) AND (${!f.product} OR l.product_id=${f.product}) GROUP BY o.id,c.name,u.name,i.id ORDER BY o.created_at,o.id`;
  }
}
export async function reportInTransaction(
  db: Database,
  actor: Actor | null,
  kind: ReportKind,
  input: unknown,
): Promise<Report> {
  const user = reportAccess(actor, kind),
    f = filtersSchema.parse(input);
  await checkScope(db, user, f);
  const statement = await query(user, kind, f);
  const result = await db.execute(
    sql`SELECT * FROM (${statement}) report_rows LIMIT 5001`,
  );
  if (result.rows.length > 5000)
    throw new AccessError(
      422,
      "Report exceeds 5,000 rows. Narrow the date range or filters.",
    );
  const rows: Row[] = result.rows.map((r) =>
    Object.fromEntries(
      columns[kind].map((c) => [
        c.key,
        r[c.key] === null || r[c.key] === undefined ? null : String(r[c.key]),
      ]),
    ),
  );
  const totals: Row = {};
  for (const c of columns[kind].filter((c) => c.total)) {
    totals[c.key] = rows.some((r) => r[c.key] === null)
      ? null
      : rows
          .reduce((sum, r) => sum.plus(r[c.key] ?? 0), new D(0))
          .toFixed(c.type === "money" ? 2 : undefined);
  }
  const notes = [
    ![
      "sales",
      "customer_sales",
      "product_sales",
      "gst",
      "payments",
      "receivables",
      "customer_balances",
      "ageing",
    ].includes(kind)
      ? "Operational records are shared; the invoice scope selector does not partition stock, purchases, production or unclassified orders."
      : f.scope === "demo"
        ? "DEMONSTRATION ONLY - SAMPLE INVOICES, NOT STATUTORY SALES"
        : "Real invoice scope; demonstration invoices excluded.",
    "Invoice/payment dates are stored business dates; timestamp boundaries use Asia/Kolkata, inclusive start and exclusive next-day end. Backdated financial entries restate their business date.",
    "Currency displays round half-up to two places; totals use unrounded source amounts, so fractional-paisa source rows can differ when summed after display rounding. Unit rates retain source precision. Unavailable values remain unknown; known movement subtotal is not complete inventory valuation.",
  ];
  if (["sales", "customer_sales", "product_sales"].includes(kind))
    notes.push(
      "Gross original invoices in the selected period; credited status is as of the as-of date. GST review reports signed credit events separately. Product filter sums matching lines, not repeated invoice totals.",
    );
  if (kind === "gst")
    notes.push(
      "Review aid for outward-supply reconciliation, not an official GSTR-1/GSTR-3B return. Full credits reverse the original snapshot amounts on the recorded credit date; no government validation.",
    );
  if (["receivables", "customer_balances", "ageing"].includes(kind))
    notes.push(
      "All invoices dated on or before as-of, regardless of period start; collections use payment date, credits use recorded local date. Product filter selects whole matching invoices. Age is days since invoice, not overdue: due dates/terms were not recorded.",
    );
  if (kind === "stock")
    notes.push(
      "Rollforward covers from through as-of. Current stock is this report with today as-of. Units are base units; do not add unlike units. Unknown historical movements conservatively propagate as in the Stage 2 stock view.",
    );
  if (kind === "ledger")
    notes.push(
      "Opening is the balance before from. Balance follows posting time and movement ID; same-timestamp movements have deterministic ordering. Source IDs link existing immutable documents.",
    );
  if (kind === "purchases")
    notes.push(
      "Only purchase documents, including drafts. Displayed totals include all displayed statuses. Dates use posting time for posted documents and creation time for drafts. No supplier tax information was recorded.",
    );
  if (kind === "production")
    notes.push(
      "Posted runs only. Material snapshots remain fixed; the existing production_costs view is adjusted only for overhead events recorded after as-of. Cost per good packet is not a final inventory valuation.",
    );
  if (kind === "payments")
    notes.push(
      "Collections sum allocations exactly once for invoices in scope; whole payment amount is informational and must not be summed alongside allocated collections.",
    );
  if (kind === "orders")
    notes.push(
      "Orders have no demo/real mode until invoiced; the scope selector does not filter orders. Status is current, not a historical order-state reconstruction.",
    );
  return {
    kind,
    title: reportNames[kind],
    filters: f,
    timezone: "Asia/Kolkata",
    generatedAt: new Date().toISOString(),
    columns: columns[kind],
    rows,
    totals,
    notes,
  };
}
export async function getReport(
  db: Database,
  actor: Actor | null,
  kind: ReportKind,
  input: unknown,
) {
  reportAccess(actor, kind);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`,
    );
    await tx.execute(sql`SET LOCAL statement_timeout='10s'`);
    return reportInTransaction(tx, actor, kind, input);
  });
}
