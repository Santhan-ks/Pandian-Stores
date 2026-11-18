"use client";
import { useRouter } from "next/navigation";
import { BillingSettings, type BillingConfiguration } from "./billing-settings";
import { SAMPLE_NOTICE } from "@/modules/billing/notice";
import { useState } from "react";
import { DeleteRecord } from "./delete-record";
import type { Role } from "@/modules/auth/policy";
import { Money as D, taxLine } from "@/modules/billing/tax";
type Line = {
  productId: string;
  product: string;
  quantity: string;
  rate: string;
  gstPercent: string;
  onHand: string;
  shortage: string;
};
type Order = {
  id: string;
  customer_id: string;
  customer: string;
  state: string;
  status: string;
  reason: string;
  lines: Line[];
  invoice_id: string;
  number: string;
  outstanding: string;
  dispatch_id: string;
  dispatched_at: string;
  dispatch_cost: string | null;
  issuance_mode: "demo" | "real";
  credited: boolean;
  snapshot: { total: string; notice?: string };
};
type Payment = {
  id: string;
  amount: string;
  reference: string;
  payment_date: string;
  method: string;
};
export function Sales({
  role,
  billing,
  initial,
  customers,
  prices,
}: {
  role: Role;
  billing: BillingConfiguration | null;
  initial: { orders: Order[]; payments: Payment[] };
  customers: { id: string; name: string }[];
  prices: { productId: string; product: string; amount: string }[];
}) {
  const [data, setData] = useState(initial),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(prices[0]?.productId ?? "");
  const [basket, setBasket] = useState<
    { productId: string; quantity: string; rate: string }[]
  >([]);
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const admin = role === "admin";
  async function send(query: string, body: unknown, form?: HTMLFormElement) {
    if (
      query.startsWith("?dispatch=") &&
      !window.confirm(
        "Post the full dispatch? Stock movements will be immutable.",
      )
    )
      return false;
    if (
      query.startsWith("?credit=") &&
      !window.confirm(
        "Issue a full credit note? This reverses the receivable, not physical dispatch.",
      )
    )
      return false;
    if (
      query.startsWith("?invoice=") &&
      !window.confirm(
        "Issue a real tax invoice using the configured business profile? The snapshot cannot be edited.",
      )
    )
      return false;
    setFailed(false);
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/sales" + query, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await r.json();
      if (r.status === 401) {
        router.push("/login");
        return false;
      }
      if (!r.ok) throw new Error(result.error ?? "Operation failed");
      setData(await (await fetch("/api/sales")).json());
      if (form) delete form.dataset.requestKey;
      setMessage("Saved.");
      return true;
    } catch (e) {
      setFailed(true);
      setMessage(e instanceof Error ? e.message : "Operation failed");
      return false;
    } finally {
      setBusy(false);
    }
  }
  function formData(form: HTMLFormElement) {
    form.dataset.requestKey ??= crypto.randomUUID();
    const data = new FormData(form);
    data.set("requestKey", form.dataset.requestKey);
    return data;
  }
  function requestKey(f: FormData) {
    return String(f.get("requestKey"));
  }
  const date = () => new Date().toISOString().slice(0, 10);
  return (
    <>
      <h1>Sales orders and billing</h1>
      {admin && billing && (
        <BillingSettings
          initial={billing}
          products={prices}
          onSave={() => router.refresh()}
        />
      )}
      <p role={failed ? "alert" : "status"}>{message}</p>
      {(admin || role === "salesman") && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = formData(form);
            if (
              await send("", {
                customerId: f.get("customer"),
                requestKey: requestKey(f),
                lines: basket,
              })
            ) {
              setBasket([]);
              delete form.dataset.requestKey;
            }
          }}
        >
          <h2>New order</h2>
          <label>
            Customer
            <select name="customer" required>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Product
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {prices.map((p) => (
                <option key={p.productId} value={p.productId}>
                  {p.product} — INR {p.amount}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              const p = prices.find((p) => p.productId === selected);
              if (p && !basket.some((l) => l.productId === selected))
                setBasket([
                  ...basket,
                  { productId: selected, quantity: "1", rate: p.amount },
                ]);
            }}
          >
            Add product
          </button>
          {basket.map((l, i) => (
            <div key={l.productId}>
              <label>
                {prices.find((p) => p.productId === l.productId)?.product}{" "}
                packets
                <input
                  aria-label="Order quantity"
                  inputMode="numeric"
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={l.quantity}
                  onChange={(e) =>
                    setBasket(
                      basket.map((x, j) =>
                        j === i ? { ...x, quantity: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <span>INR {l.rate} each</span>
              <button
                type="button"
                onClick={() => setBasket(basket.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </div>
          ))}
          <button disabled={busy || !basket.length}>Submit order</button>
        </form>
      )}
      <h2>Order history</h2>
      {!data.orders.length && <p>No orders.</p>}
      {data.orders.map((o) => (
        <section key={o.id}>
          <h3>
            {o.customer} — {o.status}
          </h3>
          <p>
            Order {o.id} {o.reason && `— ${o.reason}`}
          </p>
          {["admin", "owner"].includes(role) && (
            <DeleteRecord
              resource="orders"
              id={o.id}
              label={`${o.customer} order`}
              protectedReason={
                o.status !== "submitted"
                  ? "Reviewed/invoiced orders are retained. Use the credit/correction workflow."
                  : undefined
              }
              onDeleted={async () =>
                setData(await (await fetch("/api/sales")).json())
              }
            />
          )}
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Scrollable data table"
          >
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Packets</th>
                  <th>Rate</th>
                  <th>On hand</th>
                  <th>Shortage</th>
                  <th>Tax treatment preview</th>
                </tr>
              </thead>
              <tbody>
                {o.lines.map((l) => (
                  <tr key={l.productId}>
                    <td>{l.product}</td>
                    <td>{l.quantity}</td>
                    <td>{l.rate}</td>
                    <td>{new D(l.onHand).toFixed()}</td>
                    <td>{new D(l.shortage).toFixed()}</td>
                    <td>
                      {new D(
                        taxLine(
                          l.quantity,
                          l.rate,
                          l.gstPercent,
                          "Tamil Nadu",
                          o.state,
                        ).igst,
                      ).gt(0)
                        ? "IGST"
                        : "CGST + SGST"}{" "}
                      (Tamil Nadu seller)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {o.dispatch_id && (
            <p>
              Dispatch {o.dispatch_id} — {o.dispatched_at}. Cost of goods sold:{" "}
              {o.dispatch_cost === null
                ? "unknown (opening valuation unavailable)"
                : `INR ${o.dispatch_cost}`}
            </p>
          )}
          {o.invoice_id && ["admin", "owner"].includes(role) && (
            <DeleteRecord
              resource="invoices"
              id={o.invoice_id}
              label={`invoice ${o.number}`}
              protectedReason="Posted invoices cannot be deleted. Eligible invoices may receive a full credit."
            />
          )}
          {admin && o.status === "submitted" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = formData(e.currentTarget);
                void send("?review=" + o.id, {
                  decision: f.get("decision"),
                  reason: f.get("reason"),
                  lines: o.lines.map((l, i) => ({
                    productId: l.productId,
                    quantity: f.get("qty" + i),
                    rate: f.get("rate" + i),
                  })),
                });
              }}
            >
              <h4>Review order</h4>
              {o.lines.map((l, i) => (
                <div key={l.productId}>
                  <label>
                    {l.product} approved quantity
                    <input
                      name={"qty" + i}
                      type="number"
                      min="1"
                      step="1"
                      defaultValue={l.quantity}
                      required
                    />
                  </label>
                  <label>
                    Approved rate
                    <input
                      name={"rate" + i}
                      type="number"
                      min="0.01"
                      step="0.01"
                      defaultValue={l.rate}
                      required
                    />
                  </label>
                </div>
              ))}
              <label>
                Decision
                <select name="decision">
                  <option value="approve">Approve</option>
                  <option value="reject">Reject</option>
                </select>
              </label>
              <label>
                Review reason
                <input name="reason" minLength={3} required />
              </label>
              <button disabled={busy}>Save review</button>
            </form>
          )}
          {admin && o.status === "approved" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = formData(e.currentTarget);
                void send(
                  (f.get("mode") === "demo" ? "?demoInvoice=" : "?invoice=") +
                    o.id,
                  {
                    date: f.get("date"),
                    ...(f.get("buyerGstin")
                      ? { customerGstin: f.get("buyerGstin") }
                      : {}),
                  },
                );
              }}
            >
              <h4>Issue invoice</h4>
              <label>
                Invoice date
                <input name="date" type="date" defaultValue={date()} required />
              </label>
              <label>
                Invoice mode
                <select name="mode">
                  <option value="real">Real application invoice</option>
                  {billing?.demoEnabled && (
                    <option value="demo">Sample exercise invoice</option>
                  )}
                </select>
              </label>
              <p>
                Seller and product HSNs come from the selected business profile.
                Sample exercise invoices are not valid for tax purposes.
              </p>
              <label>
                Customer GSTIN (optional)
                <input name="buyerGstin" pattern="[0-9]{2}[A-Z0-9]{13}" />
              </label>
              <button disabled={busy}>Issue invoice</button>
            </form>
          )}
          {o.invoice_id && o.issuance_mode !== "real" && <p>{SAMPLE_NOTICE}</p>}
          {o.invoice_id && (
            <>
              <p>
                Invoice {o.number} — INR {o.snapshot.total}. Outstanding INR{" "}
                {o.outstanding}
                {o.credited ? " — credited" : ""}
              </p>
              <a href={"/api/sales?pdf=" + o.invoice_id}>
                Download invoice PDF
              </a>
            </>
          )}
          {admin && o.status === "invoiced" && (
            <button
              disabled={busy}
              onClick={() => void send("?dispatch=" + o.id, {})}
            >
              Confirm full dispatch
            </button>
          )}
          {admin && o.invoice_id && !o.credited && (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = formData(e.currentTarget);
                  void send(
                    "?payment",
                    {
                      customerId: o.customer_id,
                      date: f.get("date"),
                      reference: f.get("reference"),
                      method: f.get("method"),
                      amount: f.get("amount"),
                      requestKey: requestKey(f),
                      allocations: [
                        { invoiceId: o.invoice_id, amount: f.get("amount") },
                      ],
                    },
                    e.currentTarget,
                  );
                }}
              >
                <h4>Record payment</h4>
                <label>
                  Payment date
                  <input
                    name="date"
                    type="date"
                    defaultValue={date()}
                    required
                  />
                </label>
                <label>
                  Reference
                  <input name="reference" minLength={3} required />
                </label>
                <label>
                  Method
                  <select name="method">
                    {["cash", "bank", "upi", "cheque"].map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Amount INR
                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    max={o.outstanding}
                    step="0.01"
                    required
                  />
                </label>
                <button disabled={busy || new D(o.outstanding).lte(0)}>
                  Record payment
                </button>
              </form>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void send("?credit=" + o.invoice_id, {
                    reason: new FormData(e.currentTarget).get("reason"),
                  });
                }}
              >
                <label>
                  Full credit reason
                  <input name="reason" required minLength={3} />
                </label>
                <button disabled={busy}>Issue full credit note</button>
                <p>
                  Credits do not return dispatched stock. Paid invoices require
                  a refund workflow.
                </p>
              </form>
            </>
          )}
        </section>
      ))}
      <h2>Payment history</h2>
      {data.payments.map((p) => (
        <p key={p.id}>
          {p.payment_date.slice(0, 10)} — {p.reference} — {p.method} — INR{" "}
          {p.amount}
          {["admin", "owner"].includes(role) && (
            <DeleteRecord
              resource="payments"
              id={p.id}
              label={`payment ${p.reference}`}
              protectedReason="Payments and their allocations are immutable accounting history."
            />
          )}
        </p>
      ))}
    </>
  );
}
