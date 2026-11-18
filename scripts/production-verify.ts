import assert from "node:assert/strict";
import { request } from "node:https";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  compose,
  operationsDirectory as dir,
  localOrigin,
} from "./lib/production-local";

const origin = localOrigin();
const ca = readFileSync(resolve(dir, "local-ca.crt"));
const account = JSON.parse(
  readFileSync(resolve(dir, "operator_account.json"), "utf8"),
);
function http(
  path: string,
  method = "GET",
  body?: string,
  headers: Record<string, string> = {},
) {
  return new Promise<{
    status: number;
    headers: import("node:http").IncomingHttpHeaders;
    body: string;
  }>((resolve, reject) => {
    const req = request(
      origin + path,
      {
        ca,
        method,
        headers,
        timeout: 10000,
        family: 4,
        lookup: (_hostname, _options, callback) =>
          callback(null, "127.0.0.1", 4),
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () =>
          resolve({ status: res.statusCode!, headers: res.headers, body }),
        );
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("HTTPS request timed out.")));
    req.end(body);
  });
}
try {
  const containerId = compose(["ps", "-q", "app"], true).trim();
  const [container] = JSON.parse(
    execFileSync("docker", ["inspect", containerId], { encoding: "utf8" }),
  );
  assert.match(container.Config.User, /^1000:\d+$/);
  assert.equal(container.HostConfig.ReadonlyRootfs, true);
  assert(container.HostConfig.CapDrop.includes("ALL"));
  assert(container.HostConfig.SecurityOpt.includes("no-new-privileges:true"));
  assert(container.HostConfig.Memory > 0 && container.HostConfig.PidsLimit > 0);
  assert.equal(
    Object.values(container.NetworkSettings.Ports).some(Boolean),
    false,
  );
  assert(
    !container.Config.Env.some((value: string) =>
      /^(DATABASE_URL|BETTER_AUTH_SECRET)=/.test(value),
    ),
  );
  compose([
    "exec",
    "-T",
    "app",
    "node",
    "-e",
    "const fs=require('fs'); for(const p of ['/app/scripts','/app/drizzle','/app/.env','/app/node_modules/vitest','/app/node_modules/eslint','/run/secrets/owner_url','/run/secrets/admin_url']) {if(fs.existsSync(p)) process.exit(1)}; console.log('Minimal runtime verified: no tools, .env or administrative secrets.')",
  ]);
  const proxyId = compose(["ps", "-q", "proxy"], true).trim();
  const [proxy] = JSON.parse(
    execFileSync("docker", ["inspect", proxyId], { encoding: "utf8" }),
  );
  assert.equal(proxy.HostConfig.Init, true);
  compose([
    "exec",
    "-T",
    "proxy",
    "sh",
    "-c",
    "i=0; while [ $i -lt 200 ]; do wget -q -O /dev/null --no-check-certificate https://pandian.localhost:8443/api/health || exit 1; i=$((i+1)); done",
  ]);
  const processes = compose(
    ["exec", "-T", "proxy", "ps", "-o", "stat,comm"],
    true,
  );
  assert(
    processes.split("\n").filter((line) => /^Z\s/.test(line.trim())).length <=
      1,
    "TLS health-check children must be reaped.",
  );
  console.log(
    "200 consecutive TLS health probes passed within the unchanged PID cap; proxy init reaps child processes.",
  );
  compose([
    "run",
    "--rm",
    "--no-deps",
    "operations",
    "scripts/production-check.ts",
  ]);
  const health = await http("/api/health");
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).status, "ok");
  assert.match(String(health.headers["strict-transport-security"]), /max-age/);
  assert.equal(health.headers["x-powered-by"], undefined);
  assert.equal((await http("/api/dashboard")).status, 401);
  const headers = { Origin: origin, "Content-Type": "application/json" };
  assert.equal(
    (
      await http("/api/auth/sign-in/email", "POST", JSON.stringify(account), {
        ...headers,
        Origin: "https://untrusted.invalid",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await http(
        "/api/auth/sign-in/email",
        "POST",
        JSON.stringify({ email: account.email, password: "123456123456" }),
        headers,
      )
    ).status,
    401,
  );
  const login = await http(
    "/api/auth/sign-in/email",
    "POST",
    JSON.stringify({ email: account.email, password: account.password }),
    headers,
  );
  assert.equal(login.status, 200);
  const cookies = login.headers["set-cookie"] ?? [];
  assert(
    cookies.some(
      (value) =>
        /HttpOnly/i.test(value) &&
        /Secure/i.test(value) &&
        /SameSite=Lax/i.test(value),
    ),
  );
  const cookie = cookies.map((value) => value.split(";")[0]).join("; ");
  assert.equal(
    (await http("/api/dashboard", "GET", undefined, { Cookie: cookie })).status,
    200,
  );
  const latencies = await Promise.all(
    Array.from({ length: 20 }, async () => {
      const start = performance.now();
      assert.equal(
        (await http("/api/dashboard", "GET", undefined, { Cookie: cookie }))
          .status,
        200,
      );
      return performance.now() - start;
    }),
  );
  latencies.sort((a, b) => a - b);
  console.log(
    `Local empty-database dashboard burst: 20 concurrent authenticated requests, p95 ${Math.ceil(latencies[18])} ms; capacity under realistic data remains unverified.`,
  );
  assert.equal(
    (await http("/api/auth/sign-in/email", "POST", "x".repeat(66000), headers))
      .status,
    413,
  );
  assert.equal(
    (await http("/api/auth/sign-up/email", "POST", "{}", headers)).status,
    404,
  );
  await http("/api/auth/sign-out", "POST", "{}", {
    ...headers,
    Cookie: cookie,
  });
  assert.equal(
    (await http("/api/dashboard", "GET", undefined, { Cookie: cookie })).status,
    401,
  );
  console.log(
    "TLS certificate verified against the exported local CA; HTTPS, secure cookies, login/logout, demo-password rejection, anonymous access, origin checks, signup denial and proxy body limit passed.",
  );

  const browser = await chromium.launch();
  try {
    // This CA is deliberately not installed in the OS/browser. TLS verification above uses its actual root.
    const page = await browser.newPage({
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 850 },
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin + "/login");
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(origin + "/products");
    for (const path of [
      "/dashboard",
      "/users",
      "/customers",
      "/products",
      "/boms",
      "/inventory",
      "/production",
      "/sales",
      "/reports",
    ]) {
      const response = await page.goto(origin + path);
      assert.equal(response?.status(), 200, path);
      assert.equal(
        await page.getByText("Internal Server Error", { exact: true }).count(),
        0,
        path,
      );
    }
    assert.deepEqual(errors, []);
    console.log(
      "Hardened-image Chromium check passed: administrator login and nine workspace pages with no browser JavaScript errors. Browser bypass applied only to the uninstalled local CA; Node HTTPS independently verified it.",
    );
  } finally {
    await browser.close();
  }

  const statuses: number[] = [];
  for (let i = 0; i < 35; i++) {
    statuses.push(
      (
        await http(
          "/api/auth/sign-in/email",
          "POST",
          JSON.stringify({
            email: `invalid-${i}@pandian.local`,
            password: "incorrect-password-123",
          }),
          {
            ...headers,
            "X-Pandian-Client-IP": `192.0.2.${i + 1}`,
            "X-Forwarded-For": `198.51.100.${i + 1}`,
          },
        )
      ).status,
    );
  }
  assert(statuses.includes(429));
  assert.equal(statuses.at(-1), 429);
  console.log(
    "Forged proxy/IP headers cannot bypass the login limit; HTTP 429 observed.",
  );
  for (const [key, value] of [
    ["NOVA_ALLOW_DEMO_INVOICES", "true"],
    ["NOVA_ALLOW_DEMO_SEED", "true"],
  ]) {
    const name = "pandian-invalid-config-" + randomUUID();
    try {
      let rejected = false;
      try {
        compose(
          [
            "run",
            "--rm",
            "--no-deps",
            "--name",
            name,
            "-e",
            `${key}=${value}`,
            "app",
          ],
          true,
          20000,
        );
      } catch (error) {
        rejected = (error as { status?: number }).status === 1;
      }
      assert(
        rejected,
        "Production must exit before serving with demo flags enabled.",
      );
    } finally {
      // Only this named, disposable negative-test container is eligible for cleanup.
      try {
        execFileSync("docker", ["rm", "--force", name], { stdio: "ignore" });
      } catch {
        /* --rm already cleaned it up. */
      }
    }
  }
  console.log(
    "Actual standalone startup refused each enabled demo flag (exit 1); no listener was published by the negative-test containers.",
  );
  console.log("All production rehearsal checks passed.");
} catch (error) {
  console.error("Hardened deployment verification failed.", {
    name: error instanceof Error ? error.name : "unknown",
    message:
      error instanceof assert.AssertionError
        ? error.message
        : "Inspect sanitized service logs.",
  });
  process.exitCode = 1;
}
