"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteRecord({
  resource,
  id,
  label,
  protectedReason,
  onDeleted,
}: {
  resource: string;
  id: string;
  label: string;
  protectedReason?: string;
  onDeleted?: () => void | Promise<void>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function remove() {
    if (
      !window.confirm(
        `Delete ${label}? This removes an eligible unused record and retains its audit history.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        "/api/records?" + new URLSearchParams({ resource, id }),
        { method: "DELETE" },
      );
      const result = await response.json();
      if (response.status === 401) {
        router.push("/login");
        return;
      }
      if (!response.ok) throw new Error(result.error ?? "Delete failed.");
      if (onDeleted) await onDeleted();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="delete-record">
      <button
        type="button"
        className="delete-button"
        aria-label={`Delete ${label}`}
        disabled={busy || !!protectedReason}
        title={protectedReason}
        onClick={remove}
      >
        {busy ? "Deleting…" : "Delete"}
      </button>
      {protectedReason && <small>{protectedReason}</small>}
      {error && <span role="alert">{error}</span>}
    </span>
  );
}
