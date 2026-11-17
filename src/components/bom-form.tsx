"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
type Line = { itemId: string; quantity: string; unit: string };
type Initial = {
  productId: string;
  batchSize: string;
  expectedOutput: string;
  lines: Line[];
};
export function BomForm({
  products,
  materials,
  initial,
}: {
  products: { id: string; name: string }[];
  materials: { id: string; name: string }[];
  initial?: Initial;
}) {
  const router = useRouter();
  const [productId, setProductId] = useState(initial?.productId ?? "");
  const [batchSize, setBatchSize] = useState(initial?.batchSize ?? "1");
  const [expectedOutput, setExpectedOutput] = useState(
    initial?.expectedOutput ?? "",
  );
  const [lines, setLines] = useState<Line[]>(
    initial?.lines.map(({ itemId, quantity, unit }) => ({
      itemId,
      quantity,
      unit,
    })) ?? [{ itemId: "", quantity: "", unit: "kg" }],
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  function change(index: number, key: keyof Line, value: string) {
    setLines(
      lines.map((line, i) => (i === index ? { ...line, [key]: value } : line)),
    );
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/boms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          batchSize,
          expectedOutput,
          outputUnit: "packet",
          lines,
        }),
      });
      const result = await response.json();
      if (response.status === 401) {
        router.push("/login");
        return;
      }
      if (!response.ok) throw new Error(result.error);
      router.push("/boms/" + result.id);
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to publish.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <h2>{initial ? "Publish a new revision" : "Create BOM"}</h2>
      <p>
        Publishing preserves this revision. Further changes create a new
        revision.
      </p>
      <div className="fields">
        <label>
          Product
          <select
            name="productId"
            required
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
          >
            <option value="">Select…</option>
            {products
              .filter((p) => !initial || p.id === initial.productId)
              .map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Standard batch size (batches)
          <input
            name="batchSize"
            required
            value={batchSize}
            onChange={(e) => setBatchSize(e.target.value)}
          />
        </label>
        <label>
          Expected good packets
          <input
            name="expectedOutput"
            required
            value={expectedOutput}
            onChange={(e) => setExpectedOutput(e.target.value)}
          />
        </label>
      </div>
      {lines.map((line, i) => (
        <fieldset key={i}>
          <legend>Component {i + 1}</legend>
          <div className="fields">
            <label>
              Material
              <select
                required
                value={line.itemId}
                onChange={(e) => change(i, "itemId", e.target.value)}
              >
                <option value="">Select…</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Quantity
              <input
                required
                value={line.quantity}
                onChange={(e) => change(i, "quantity", e.target.value)}
              />
            </label>
            <label>
              Unit
              <select
                value={line.unit}
                onChange={(e) => change(i, "unit", e.target.value)}
              >
                {["g", "kg", "ml", "L", "piece"].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            disabled={lines.length === 1}
            onClick={() => setLines(lines.filter((_, index) => i !== index))}
          >
            Remove component
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        onClick={() =>
          setLines([...lines, { itemId: "", quantity: "", unit: "kg" }])
        }
      >
        Add component
      </button>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy}>{busy ? "Publishing…" : "Publish BOM"}</button>
    </form>
  );
}
