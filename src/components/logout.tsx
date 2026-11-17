"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function Logout() {
  const router = useRouter();
  const [error, setError] = useState("");
  return (
    <>
      <button
        onClick={async () => {
          try {
            const result = await fetch("/api/auth/sign-out", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            });
            if (!result.ok) throw new Error();
            router.push("/login");
            router.refresh();
          } catch {
            setError("Logout failed. Please retry.");
          }
        }}
      >
        Log out
      </button>
      {error && <span role="alert">{error}</span>}
    </>
  );
}
