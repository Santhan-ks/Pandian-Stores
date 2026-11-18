"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export type Field = {
  key: string;
  label: string;
  options?: { value: string; label: string }[];
  type?: string;
};
export function MasterEditor({
  resource,
  rows,
  fields,
  writable,
}: {
  resource: string;
  rows: Record<string, unknown>[];
  fields: Field[];
  writable: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(0);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch(
        "/api/masters/" + resource + (editing ? "?id=" + editing.id : ""),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        },
      );
      const result = await response.json();
      if (response.status === 401) {
        router.push("/login");
        return;
      }
      if (!response.ok) throw new Error(result.error);
      setEditing(null);
      setKey((k) => k + 1);
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {!rows.length && <p>No records yet.</p>}
      <div
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Scrollable data table"
      >
        <table>
          <thead>
            <tr>
              {fields.map((f) => (
                <th key={f.key}>{f.label}</th>
              ))}
              {writable && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={String(row.id)}>
                {fields.map((f) => (
                  <td key={f.key}>
                    {f.options?.find((o) => o.value === row[f.key])?.label ??
                      String(row[f.key] ?? "")}
                  </td>
                ))}
                {writable && (
                  <td>
                    <button
                      onClick={() => {
                        setEditing(row);
                        setKey((k) => k + 1);
                        setError("");
                      }}
                    >
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p>No records yet.</p>}
      {writable && (
        <section>
          <h2>{editing ? "Edit record" : "Add record"}</h2>
          <form key={key} onSubmit={submit}>
            <div className="fields">
              {fields.map((f) => (
                <label key={f.key}>
                  {f.label}
                  {f.options ? (
                    <select
                      name={f.key}
                      required
                      defaultValue={String(
                        f.type === "password" ? "" : (editing?.[f.key] ?? ""),
                      )}
                    >
                      <option value="">Select…</option>
                      {f.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      name={f.key}
                      type={f.type ?? "text"}
                      required={f.type !== "password" || !editing}
                      maxLength={500}
                      defaultValue={String(
                        f.type === "password" ? "" : (editing?.[f.key] ?? ""),
                      )}
                    />
                  )}
                </label>
              ))}
            </div>
            {error && <p role="alert">{error}</p>}
            <button disabled={busy}>{busy ? "Saving…" : "Save"}</button>
            {editing && (
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setKey((k) => k + 1);
                }}
              >
                Cancel edit
              </button>
            )}
          </form>
        </section>
      )}
    </>
  );
}
