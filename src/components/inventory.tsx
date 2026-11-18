"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Decimal } from "decimal.js";
type Row = Record<string, unknown>;
const money = (value: unknown) =>
  value === null
    ? "Unavailable"
    : new Decimal(String(value)).toFixed(2, Decimal.ROUND_HALF_UP);
export function Inventory({
  data,
  items,
  suppliers,
  role,
}: {
  data: { summary: Row[]; ledger: Row[]; documents: Row[]; lines: Row[] };
  items: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  role: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Row | null>(null);
  const [category, setCategory] = useState(
    role === "production" ? "purchase" : "opening",
  );
  const [lines, setLines] = useState([
    { itemId: "", quantity: "", unit: "kg", unitRate: "" },
  ]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  async function request(body: unknown, id?: string) {
    if (
      id &&
      !window.confirm(
        "Post this stock document? Posted movements cannot be edited.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(
        "/api/inventory" +
          (id ? "?post=" + id : editing ? "?edit=" + editing.id : ""),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const result = await r.json();
      if (r.status === 401) {
        router.push("/login");
        return;
      }
      if (!r.ok) throw new Error(result.error);
      if (!id) {
        setKey(crypto.randomUUID());
        setEditing(null);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  function update(i: number, key: string, value: string) {
    setLines(lines.map((l, n) => (i === n ? { ...l, [key]: value } : l)));
  }
  return (
    <>
      <h1>Inventory</h1>
      <form method="get">
        <div className="fields">
          <label>
            Item
            <select name="item">
              <option value="">All items</option>
              {items.map((i) => (
                <option value={i.id} key={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Category
            <select name="category">
              <option value="">All categories</option>
              {["opening", "purchase", "adjustment"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            From (UTC)
            <input type="date" name="from" />
          </label>
          <label>
            To (UTC)
            <input type="date" name="to" />
          </label>
        </div>
        <button>Filter ledger</button>
      </form>
      <h2>Current stock and valuation</h2>
      <p>
        Quantities and average rates use base units. Unknown valuations are
        explicitly unavailable. Category and date filters apply to the ledger;
        this summary is current.
      </p>
      <div
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Scrollable data table"
      >
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Quantity</th>
              <th>Unit</th>
              <th>Value (INR)</th>
              <th>Average INR per base unit</th>
            </tr>
          </thead>
          <tbody>
            {data.summary.map((r) => (
              <tr key={String(r.id)}>
                <td>{String(r.name)}</td>
                <td>{String(r.quantity)}</td>
                <td>{String(r.base_unit)}</td>
                <td>{money(r.value)}</td>
                <td>
                  {r.average_rate === null
                    ? "Unavailable"
                    : String(r.average_rate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Stock ledger</h2>
      {!data.ledger.length && <p>No movements match these filters.</p>}
      {data.ledger.map((r) => (
        <details key={String(r.id)}>
          <summary>
            {String(r.item)} · {String(r.quantity)} {String(r.base_unit)} ·{" "}
            {String(r.category)} · {String(r.posted_at)}
          </summary>
          <dl>
            {[
              "id",
              "document_id",
              "line_id",
              "reason",
              "quantity_before",
              "quantity_after",
              "actor",
            ].map((k) => (
              <div key={k}>
                <dt>{k.replaceAll("_", " ")}</dt>
                <dd>{String(r[k])}</dd>
              </div>
            ))}
            <dt>Signed value (INR)</dt>
            <dd>{money(r.value)}</dd>
          </dl>
        </details>
      ))}
      <h2>Documents and purchase history</h2>
      {!data.documents.length && <p>No documents yet.</p>}
      {data.documents.map((d) => (
        <details key={String(d.id)}>
          <summary>
            {String(d.category)} · {String(d.status)} · {String(d.reason)}
          </summary>
          <p>
            Source: {String(d.id)} · Supplier:{" "}
            {String(d.supplier ?? "Not applicable")} · Created:{" "}
            {String(d.created_at)} · Posted:{" "}
            {String(d.posted_at ?? "Not posted")}
          </p>
          <ul>
            {data.lines
              .filter((l) => l.document_id === d.id)
              .map((l) => (
                <li key={String(l.id)}>
                  {String(l.item)}: {String(l.quantity)} {String(l.unit)} @{" "}
                  {l.unit_rate === null ? "Unavailable" : String(l.unit_rate)}{" "}
                  INR/{String(l.unit)}
                </li>
              ))}
          </ul>
          {d.status === "draft" &&
            d.category !== "production" &&
            (role === "admin" ||
              (role === "production" && d.category === "purchase")) && (
              <>
                <button
                  disabled={busy}
                  onClick={() => {
                    setEditing(d);
                    setCategory(String(d.category));
                    setKey(String(d.request_key));
                    setLines(
                      data.lines
                        .filter((l) => l.document_id === d.id)
                        .map((l) => ({
                          itemId: String(l.item_id),
                          quantity: String(l.quantity),
                          unit: String(l.unit),
                          unitRate:
                            l.unit_rate === null ? "" : String(l.unit_rate),
                        })),
                    );
                  }}
                >
                  Edit draft
                </button>
                <button
                  disabled={busy}
                  onClick={() => request({}, String(d.id))}
                >
                  Post document
                </button>
              </>
            )}
        </details>
      ))}
      {["admin", "production"].includes(role) && (
        <form
          key={String(editing?.id ?? key)}
          onSubmit={(e) => {
            e.preventDefault();
            const form = Object.fromEntries(new FormData(e.currentTarget));
            request({
              category,
              supplierId: category === "purchase" ? form.supplierId : null,
              reason: form.reason,
              requestKey: key,
              lines: lines.map((l) => ({
                ...l,
                unitRate:
                  category === "adjustment" || l.unitRate === ""
                    ? null
                    : l.unitRate,
              })),
            });
          }}
        >
          <h2>{editing ? "Edit draft" : "Create draft"}</h2>
          <p>
            Review the saved draft before posting. Adjustments use a signed
            quantity change and require a reason. Their valuation uses the
            existing average. Unposted mistakes can be replaced by a new draft.
          </p>
          <div className="fields">
            <label>
              Document type
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {(role === "production"
                  ? ["purchase"]
                  : ["opening", "purchase", "adjustment"]
                ).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            {category === "purchase" && (
              <label>
                Supplier
                <select
                  name="supplierId"
                  required
                  defaultValue={String(editing?.supplier_id ?? "")}
                >
                  <option value="">Select supplier</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Reason / reference
              <input
                name="reason"
                required
                minLength={3}
                defaultValue={String(editing?.reason ?? "")}
              />
            </label>
          </div>
          {lines.map((l, i) => (
            <fieldset key={i}>
              <legend>Line {i + 1}</legend>
              <div className="fields">
                <label>
                  Inventory item
                  <select
                    required
                    value={l.itemId}
                    onChange={(e) => update(i, "itemId", e.target.value)}
                  >
                    <option value="">Select item</option>
                    {items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {category === "adjustment"
                    ? "Signed quantity change"
                    : "Quantity"}
                  <input
                    required
                    value={l.quantity}
                    onChange={(e) => update(i, "quantity", e.target.value)}
                  />
                </label>
                <label>
                  Unit
                  <select
                    value={l.unit}
                    onChange={(e) => update(i, "unit", e.target.value)}
                  >
                    {["g", "kg", "ml", "L", "piece", "packet"].map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                </label>
                {category !== "adjustment" && (
                  <label>
                    INR per selected unit (blank = unknown)
                    <input
                      required={category === "purchase"}
                      value={l.unitRate}
                      onChange={(e) => update(i, "unitRate", e.target.value)}
                    />
                  </label>
                )}
              </div>
              <button
                type="button"
                disabled={lines.length === 1}
                onClick={() => setLines(lines.filter((_, n) => n !== i))}
              >
                Remove line
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            onClick={() =>
              setLines([
                ...lines,
                { itemId: "", quantity: "", unit: "kg", unitRate: "" },
              ])
            }
          >
            Add line
          </button>
          <button disabled={busy}>Save draft</button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
