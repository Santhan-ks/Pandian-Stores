"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function Login() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = Object.fromEntries(new FormData(event.currentTarget));
      const passwordField = event.currentTarget.querySelector<HTMLInputElement>(
        'input[name="password"]',
      );
      if (passwordField) passwordField.value = "";
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        setError(
          response.status === 429
            ? "Too many attempts. Try again shortly."
            : "Sign-in failed. Check your email and password.",
        );
        return;
      }
      router.push("/products");
      router.refresh();
    } catch {
      setError("Unable to connect. Please retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <h1>NOVA</h1>
      <h2>Sign in</h2>
      <form onSubmit={submit}>
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </main>
  );
}
