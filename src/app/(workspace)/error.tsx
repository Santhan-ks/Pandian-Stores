"use client";
import Link from "next/link";
export default function WorkspaceError({ reset }: { reset: () => void }) {
  return (
    <section>
      <h1>Unable to load this page</h1>
      <p role="alert">
        The request could not be completed. Check your connection and try again.
        If your session expired, sign in again.
      </p>
      <button onClick={reset}>Try again</button>
      <p>
        <Link href="/login">Sign in again</Link>
      </p>
    </section>
  );
}
