"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ProductionDecimal as D } from "@/modules/production/calculations";
type Line = { itemId: string; item: string; quantity: string; unit: string };
export type BomChoice = {
  id: string;
  productId: string;
  product: string;
  revision: number;
  batchSize: string;
  expectedOutput: string;
  lines: Line[];
};
type Actual = { itemId: string; actual: string; damaged: string; unit: string };
type Snapshot = {
  revision: number;
  batchSize: string;
  expectedOutput: string;
  goodOutput: string;
  tolerance: string;
  yield: { percent: string | null; flagged: boolean };
  lines: (Line & {
    planned: string;
    actual: string;
    damaged: string;
    percent: string | null;
    flagged: boolean;
  })[];
};
export type Run = {
  id: string;
  bom_id: string;
  product_id: string;
  product: string;
  status: string;
  batches: string;
  good_output: string;
  tolerance: string;
  request_key: string;
  snapshot: Snapshot;
  material_cost: string | null;
  overheads: string;
  total_cost: string | null;
  cost_per_packet: string | null;
  posted_at: string | null;
  material_costs:
    | {
        itemId: string;
        quantity: string;
        baseUnit: string;
        cost: string | null;
      }[]
    | null;
};
export type Overhead = {
  id: string;
  run_id: string;
  category: string;
  amount: string;
  reason: string;
  actor: string;
  created_at: string;
};
const money = (v: string | null) =>
  v === null ? "Unavailable" : new D(v).toFixed(2);
export function Production({
  runs,
  boms,
  history,
  writable,
}: {
  runs: Run[];
  boms: BomChoice[];
  history: Overhead[];
  writable: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [product, setProduct] = useState("");
  const [bomId, setBomId] = useState("");
  const [batches, setBatches] = useState("1");
  const [good, setGood] = useState("");
  const [tolerance, setTolerance] = useState("3");
  const [inputs, setInputs] = useState<Actual[]>([]);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [editing, setEditing] = useState<string | null>(null);
  const bom = boms.find((b) => b.id === bomId);
  const products = Array.from(
    new Map(boms.map((b) => [b.productId, b.product])).entries(),
  );
  function choose(id: string) {
    setBomId(id);
    const b = boms.find((b) => b.id === id);
    setInputs(
      b?.lines.map((l) => ({
        itemId: l.itemId,
        actual: l.quantity,
        damaged: "0",
        unit: l.unit,
      })) ?? [],
    );
    setBatches(b?.batchSize ?? "1");
    setGood(b?.expectedOutput ?? "");
  }
  async function request(body: unknown, query = "") {
    if (
      query.startsWith("?post=") &&
      !window.confirm(
        "Post production? All material issues and finished output will be immutable.",
      )
    )
      return false;
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/production" + query, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (response.status === 401) {
        router.push("/login");
        return false;
      }
      if (!response.ok) throw new Error(data.error);
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed");
      return false;
    } finally {
      setBusy(false);
    }
  }
  function planned(value: string) {
    try {
      return bom ? new D(value).mul(batches).div(bom.batchSize).toFixed() : "";
    } catch {
      return "Enter a batch quantity";
    }
  }
  return (
    <>
      <h1>Production</h1>
      <p>
        Consumed quantities include damage. Only accepted good packets enter
        finished stock. Posting is irreversible; later overheads update run
        costing without changing stock.
      </p>
      {error && <p role="alert">{error}</p>}
      {writable && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await request(
                {
                  bomId,
                  batches,
                  goodOutput: good,
                  tolerance,
                  inputs,
                  requestKey: key,
                },
                editing ? "?edit=" + editing : "",
              )
            ) {
              setKey(crypto.randomUUID());
              setEditing(null);
            }
          }}
        >
          <h2>
            {editing ? "Edit draft production run" : "Create production run"}
          </h2>
          <div className="fields">
            <label>
              Finished product
              <select
                value={product}
                required
                onChange={(e) => {
                  setProduct(e.target.value);
                  choose("");
                }}
              >
                <option value="">Select product</option>
                {products.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Published BOM revision
              <select
                required
                value={bomId}
                onChange={(e) => choose(e.target.value)}
              >
                <option value="">Select revision</option>
                {boms
                  .filter((b) => b.productId === product)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      Revision {b.revision}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Planned batches
              <input
                required
                value={batches}
                onChange={(e) => setBatches(e.target.value)}
              />
            </label>
            <label>
              Accepted good packets
              <input
                required
                value={good}
                onChange={(e) => setGood(e.target.value)}
              />
            </label>
            <label>
              Absolute variance tolerance (%)
              <input
                required
                value={tolerance}
                onChange={(e) => setTolerance(e.target.value)}
              />
            </label>
          </div>
          {bom && (
            <p>
              Expected output: {planned(bom.expectedOutput)} packets. Cartons
              are consumed as entered; loose packets do not imply another
              carton.
            </p>
          )}
          {inputs.map((line, i) => (
            <fieldset key={line.itemId}>
              <legend>
                {bom?.lines.find((l) => l.itemId === line.itemId)?.item}
              </legend>
              <p>
                Planned:{" "}
                {planned(
                  bom?.lines.find((l) => l.itemId === line.itemId)?.quantity ??
                    "0",
                )}{" "}
                {bom?.lines.find((l) => l.itemId === line.itemId)?.unit}
              </p>
              <div className="fields">
                {(["actual", "damaged"] as const).map((k) => (
                  <label key={k}>
                    {k === "actual"
                      ? "Total consumed"
                      : "Damaged / wasted (included)"}
                    <input
                      required
                      value={line[k]}
                      onChange={(e) =>
                        setInputs(
                          inputs.map((l, n) =>
                            n === i ? { ...l, [k]: e.target.value } : l,
                          ),
                        )
                      }
                    />
                  </label>
                ))}
                <label>
                  Consumption unit
                  <select
                    value={line.unit}
                    onChange={(e) =>
                      setInputs(
                        inputs.map((l, n) =>
                          n === i ? { ...l, unit: e.target.value } : l,
                        ),
                      )
                    }
                  >
                    {["g", "kg", "ml", "L", "piece"].map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                </label>
              </div>
            </fieldset>
          ))}
          <button disabled={busy || !bom}>Save production draft</button>
          {editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setKey(crypto.randomUUID());
              }}
            >
              Cancel edit
            </button>
          )}
        </form>
      )}
      <h2>Production history</h2>
      {!runs.length && <p>No production runs yet.</p>}
      {runs.map((run) => (
        <details key={run.id}>
          <summary>
            {run.product} · BOM {run.snapshot.revision} · {run.status} ·{" "}
            {run.id}
          </summary>
          <p>
            {run.batches} batches · Expected {run.snapshot.expectedOutput} ·
            Accepted {run.good_output} packets · Posted{" "}
            {run.posted_at ?? "Not yet"}
          </p>
          <p>
            Yield variance: {run.snapshot.yield.percent ?? "Not defined"}%{" "}
            {run.snapshot.yield.flagged ? "— Alert" : ""} · tolerance{" "}
            {run.tolerance}%
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
                  <th>Material</th>
                  <th>Planned</th>
                  <th>Consumed</th>
                  <th>Damaged (included)</th>
                  <th>Unit</th>
                  <th>Variance %</th>
                  <th>Cost INR</th>
                </tr>
              </thead>
              <tbody>
                {run.snapshot.lines.map((l) => (
                  <tr key={l.itemId}>
                    <td>{l.item}</td>
                    <td>{l.planned}</td>
                    <td>{l.actual}</td>
                    <td>{l.damaged}</td>
                    <td>{l.unit}</td>
                    <td>
                      {l.percent ?? "Not defined"} {l.flagged ? "Alert" : ""}
                    </td>
                    <td>
                      {money(
                        run.material_costs?.find((c) => c.itemId === l.itemId)
                          ?.cost ?? null,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Materials: INR {money(run.material_cost)} · Overheads: INR{" "}
            {money(run.overheads)} · Run total: INR {money(run.total_cost)} ·
            Cost per good packet: INR {money(run.cost_per_packet)}
          </p>
          <p>
            Run cost is separate from aggregate finished inventory valuation,
            which can remain unknown because of opening stock. Finished receipt
            value is provisional material cost; later overhead events do not
            revalue it.
          </p>
          <ul>
            {history
              .filter((o) => o.run_id === run.id)
              .map((o) => (
                <li key={o.id}>
                  {o.category}: INR {money(o.amount)} · {o.reason} · {o.actor} ·{" "}
                  {o.created_at}
                </li>
              ))}
          </ul>
          {writable && run.status === "draft" && (
            <>
              <button
                disabled={busy}
                onClick={() => request({}, "?post=" + run.id)}
              >
                Post production
              </button>
              <button
                onClick={() => {
                  setEditing(run.id);
                  setProduct(run.product_id);
                  setBomId(run.bom_id);
                  setBatches(run.batches);
                  setGood(run.good_output);
                  setTolerance(run.tolerance);
                  setKey(run.request_key);
                  setInputs(
                    run.snapshot.lines.map((l) => ({
                      itemId: l.itemId,
                      actual: l.actual,
                      damaged: l.damaged,
                      unit: l.unit,
                    })),
                  );
                }}
              >
                Edit production draft
              </button>
            </>
          )}
          {writable && (
            <OverheadForm
              busy={busy}
              submit={(body) => request(body, "?overhead=" + run.id)}
            />
          )}
        </details>
      ))}
    </>
  );
}
function OverheadForm({
  submit,
  busy,
}: {
  submit: (body: unknown) => Promise<boolean>;
  busy: boolean;
}) {
  const [key, setKey] = useState(() => crypto.randomUUID());
  return (
    <form
      key={key}
      onSubmit={async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.currentTarget));
        if (await submit({ ...data, requestKey: key }))
          setKey(crypto.randomUUID());
      }}
    >
      <h3>Add overhead</h3>
      <div className="fields">
        <label>
          Overhead category
          <select name="category">
            <option value="labour">Labour</option>
            <option value="gas_power">Gas / power</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          Amount (INR)
          <input name="amount" required />
        </label>
        <label>
          Overhead reason
          <input name="reason" minLength={3} required />
        </label>
      </div>
      <button disabled={busy}>Add overhead</button>
    </form>
  );
}
