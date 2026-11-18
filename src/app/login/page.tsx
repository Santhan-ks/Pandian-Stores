"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Brand } from "@/components/brand";
export default function Login() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
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
    <main className="login-shell">
      <section className="login-story" aria-label="Pandian Stores workspace">
        <Brand />
        <div className="login-story-copy">
          <p className="eyebrow">FROM THE FACTORY TO THE STORE</p>
          <h1>
            Good food.
            <br />
            Better managed.
          </h1>
          <p>
            Orders, ingredients, production and accounts. One clear view of your
            everyday work.
          </p>
        </div>
        <figure className="login-product">
          <Image
            src="/images/murukku.webp"
            alt="Illustrative golden murukku snacks on a black plate"
            width={900}
            height={900}
            priority
            unoptimized
          />
          <figcaption>Murukku / Product illustration</figcaption>
        </figure>
        <p className="login-story-footer">
          PANDIAN STORES <span>ORDER TO AUDIT</span>
        </p>
      </section>
      <section className="login-panel">
        <div className="login-form-wrap">
          <div className="login-mobile-brand">
            <Brand />
          </div>
          <p className="eyebrow">YOUR WORKSPACE, READY WHEN YOU ARE</p>
          <h2>Welcome back</h2>
          <p className="muted">
            Sign in with your assigned account to continue.
          </p>
          <form onSubmit={submit} aria-busy={busy}>
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
              />
            </label>
            <label htmlFor="login-password" className="password-label">
              Password
            </label>
            <span className="password-input">
              <input
                id="login-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="password-toggle"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </span>
            {error && <p role="alert">{error}</p>}
            <button className="sign-in-button" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
              <span aria-hidden="true">→</span>
            </button>
          </form>
          <p className="login-help">
            Need an account or a password reset?
            <br />
            Contact your factory administrator.
          </p>
        </div>
        <p className="login-footnote">
          Access is limited to your assigned role and customers.
        </p>
      </section>
    </main>
  );
}
