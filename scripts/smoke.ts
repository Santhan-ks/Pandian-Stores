import "dotenv/config";
import assert from "node:assert/strict";
const base = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const password = process.env.DEMO_PASSWORD;
assert(password, "DEMO_PASSWORD is required");
assert.equal((await fetch(base + "/api/health")).status, 200);
assert.equal((await fetch(base + "/api/masters/customers")).status, 401);
assert.equal(
  (await fetch(base + "/products", { redirect: "manual" })).status,
  307,
);
for (const [email, expected] of [
  ["salesman.a", "demo-retailer-a"],
  ["salesman.b", "demo-distributor-b"],
  ["auditor", null],
  ["admin", null],
]) {
  const response: Response = await fetch(base + "/api/auth/sign-in/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ email: email + "@example.test", password }),
  });
  assert.equal(response.status, 200, "Login failed: " + email);
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const headers = {
    Cookie: cookie,
    Origin: base,
    "Content-Type": "application/json",
  };
  const customers = await fetch(base + "/api/masters/customers", { headers });
  assert.equal(customers.status, 200);
  if (expected)
    assert.deepEqual(
      (await customers.json()).map((c: { id: string }) => c.id),
      [expected],
    );
  if (email !== "admin")
    assert.equal(
      (
        await fetch(base + "/api/masters/suppliers", {
          method: "POST",
          headers,
          body: "{}",
        })
      ).status,
      403,
    );
  assert.equal(
    (
      await fetch(base + "/api/auth/sign-out", {
        method: "POST",
        headers,
        body: "{}",
      })
    ).status,
    200,
  );
  assert.equal(
    (await fetch(base + "/api/masters/customers", { headers })).status,
    401,
  );
}
console.log(
  "HTTP smoke passed: health, protected pages/API, login, customer isolation, write restrictions and logout.",
);
