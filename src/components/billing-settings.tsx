"use client";
import { useState } from "react";
import { SAMPLE_NOTICE } from "@/modules/billing/notice";
type Profile = {
  mode: string;
  name: string;
  address: string;
  state: string;
  gstin: string;
  products: { productId: string; hsn: string }[];
};
export function BillingSettings({
  initial,
  products,
  onSave,
}: {
  initial: { profiles: Profile[]; demoEnabled: boolean };
  products: { productId: string; product: string }[];
  onSave: () => void;
}) {
  const [profiles, setProfiles] = useState(initial.profiles),
    [mode, setMode] = useState("real"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const current = profiles.find((p) => p.mode === mode);
  return (
    <details>
      <summary>Business profile and product HSN configuration</summary>
      <p>
        Real invoices require a valid seller profile and an HSN for each
        product. Configure product GST rates in Prices. Local GSTIN checks do
        not verify active registration.
      </p>
      <label>
        Profile mode
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="real">Real application billing</option>
          {initial.demoEnabled && (
            <option value="demo">Exercise demo only</option>
          )}
        </select>
      </label>
      {mode === "demo" && <p>{SAMPLE_NOTICE}</p>}
      <form
        key={mode + JSON.stringify(current)}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMessage("");
          const f = new FormData(e.currentTarget);
          try {
            const r = await fetch("/api/billing", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                mode,
                name: f.get("name"),
                address: f.get("address"),
                state: f.get("state"),
                gstin: f.get("gstin"),
                products: products
                  .map((p) => ({
                    productId: p.productId,
                    hsn: f.get("hsn-" + p.productId),
                  }))
                  .filter((p) => p.hsn),
              }),
            });
            const body = await r.json();
            if (!r.ok) throw new Error(body.error ?? "Save failed");
            setProfiles((await (await fetch("/api/billing")).json()).profiles);
            setMessage("Profile saved.");
            onSave();
          } catch (e) {
            setMessage(e instanceof Error ? e.message : "Save failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Business name
          <input
            name="name"
            required
            minLength={2}
            maxLength={100}
            defaultValue={current?.name ?? ""}
          />
        </label>
        <label>
          Business address
          <input
            name="address"
            required
            minLength={5}
            maxLength={200}
            defaultValue={current?.address ?? ""}
          />
        </label>
        <label>
          Business state
          <select name="state" defaultValue={current?.state ?? "Tamil Nadu"}>
            <option>Tamil Nadu</option>
            <option>Karnataka</option>
          </select>
        </label>
        <label>
          Business GSTIN
          <input name="gstin" required defaultValue={current?.gstin ?? ""} />
        </label>
        {products.map((p) => (
          <label key={p.productId}>
            {p.product} HSN
            <input
              name={"hsn-" + p.productId}
              pattern="[0-9]{4,8}"
              defaultValue={
                current?.products?.find((t) => t.productId === p.productId)
                  ?.hsn ?? ""
              }
            />
          </label>
        ))}
        <button disabled={busy}>Save business profile</button>
        <p role="status">{message}</p>
      </form>
    </details>
  );
}
export type BillingConfiguration = {
  profiles: Profile[];
  demoEnabled: boolean;
};
