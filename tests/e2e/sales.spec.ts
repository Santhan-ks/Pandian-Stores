import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
});
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { productionFixture } from "../../scripts/production-fixture";
import * as schema from "../../src/lib/db/schema";
test("mobile order to approval, invoice PDF, dispatch, partial collection and auditor view", async ({
  page,
  browserName,
}) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 360, height: 800 });
  execFileSync(
    process.execPath,
    ["--import", "tsx", "scripts/prepare-e2e.ts"],
    { env: { ...process.env, NOVA_ALLOW_DEMO_INVOICES: "true" } },
  );
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  try {
    await productionFixture(drizzle(pool, { schema }));
  } finally {
    await pool.end();
  }
  async function login(email: string) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page
      .getByLabel("Password", { exact: true })
      .fill(process.env.DEMO_PASSWORD!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/products/);
    await page.goto("/sales");
  }
  await login("salesman.a@example.test");
  if (browserName === "webkit") {
    // WebKit's default tab order omits anchors; verify Enter activation separately.
    await page.getByRole("link", { name: "Skip to content" }).focus();
  } else {
    await page.keyboard.press("Tab");
  }
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  const orderStarted = performance.now();
  await expect(
    page.getByRole("option", { name: "Distributor B", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  await page.getByLabel("Order quantity").fill("150");
  await page.getByRole("button", { name: "Submit order", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Retailer A — submitted" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/stage6-mobile.png",
    fullPage: true,
  });
  const orderMs = performance.now() - orderStarted;
  expect(orderMs).toBeLessThan(60000);
  console.log(`Mobile 360px order entry: ${orderMs.toFixed(0)} ms`);
  await page.getByRole("button", { name: "Log out" }).click();
  await login("admin@example.test");
  await page.setViewportSize({ width: 768, height: 1024 });
  for (const path of [
    "/users",
    "/customers",
    "/territories",
    "/suppliers",
    "/materials",
    "/products",
    "/prices",
    "/boms",
    "/boms/demo-bom-1",
    "/inventory",
    "/production",
    "/reports",
    "/dashboard",
    "/sales",
  ]) {
    await page.goto(path);
    await expect(page.locator("main h1")).toBeVisible();
    if (path === "/dashboard")
      await page.screenshot({
        path: "test-results/stage6-tablet.png",
        fullPage: true,
      });
    await expect(page).toHaveTitle(/\| Pandian Stores$/);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 360, height: 800 });
  await page
    .getByText("Business profile and product HSN configuration", {
      exact: true,
    })
    .click();
  await page
    .getByRole("combobox", { name: "Profile mode", exact: true })
    .selectOption("demo");
  await expect(page.getByLabel("Business GSTIN", { exact: true })).toHaveValue(
    "DEMO-NOT-A-GSTIN",
  );
  await page
    .getByRole("button", { name: "Save business profile", exact: true })
    .click();
  await expect(page.getByText("Profile saved.", { exact: true })).toBeVisible();
  await page
    .getByText("Business profile and product HSN configuration", {
      exact: true,
    })
    .click();
  await page.getByLabel("Review reason").fill("Benchmark stock verified");
  await page.getByRole("button", { name: "Save review" }).click();
  await expect(
    page.getByRole("heading", { name: "Retailer A — approved" }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Invoice mode", exact: true })
    .selectOption("demo");
  await page
    .getByRole("button", { name: "Issue invoice", exact: true })
    .click();
  await expect(page.getByText(/Outstanding INR 7875/)).toBeVisible();
  await expect(
    page
      .locator("section")
      .getByText("SAMPLE INVOICE \u2014 NOT VALID FOR TAX PURPOSES", {
        exact: true,
      }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download invoice PDF" }).click();
  const pdf = await download;
  expect(pdf.suggestedFilename()).toBe("invoice.pdf");
  const bytes = readFileSync((await pdf.path())!);
  expect(bytes.toString("latin1")).toContain(
    "SAMPLE INVOICE \x97 NOT VALID FOR TAX PURPOSES",
  );
  expect(bytes.toString("latin1")).toContain("Invoice total INR: 7875.00");
  page.removeAllListeners("dialog");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Confirm full dispatch" }).click();
  await expect(
    page.getByRole("heading", { name: "Retailer A — invoiced" }),
  ).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Confirm full dispatch" }).click();
  await expect(
    page.getByRole("heading", { name: "Retailer A — dispatched" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "88", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Reference", { exact: true })
    .fill("Browser collection");
  await page.getByLabel("Amount INR", { exact: true }).fill("4000");
  await page
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  await expect(page.getByText(/Outstanding INR 3875/)).toBeVisible();
  // Retain the admin's valid session while visiting the other roles, respecting the login rate limit.
  const invoiceId = (
    await (await page.request.get("/api/sales")).json()
  ).orders.find((o: { invoice_id: string }) => o.invoice_id).invoice_id;
  const adminCookies = await page.context().cookies();
  await page.context().clearCookies();
  await login("auditor@example.test");
  await expect(page.getByText(/Outstanding INR 3875/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Record payment", exact: true }),
  ).toHaveCount(0);
  await page.goto(
    "/reports?kind=sales&from=2026-11-01&to=2026-11-30&asOf=2026-11-30",
  );
  await expect(
    page.getByText("No records for the selected filters.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Invoice scope", exact: true })
    .selectOption("demo");
  await page.getByRole("button", { name: "Run report", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "Retailer A", exact: true }),
  ).toBeVisible();
  const csvDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download CSV", exact: true }).click();
  const csvFile = await csvDownload;
  expect(csvFile.suggestedFilename()).toBe("pandian-stores-sales-demo.csv");
  const csv = readFileSync((await csvFile.path())!, "utf8");
  expect(csv).toContain('"7875.00"');
  expect(csv).toContain("DEMONSTRATION ONLY");
  const reportDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download PDF", exact: true }).click();
  const reportFile = await reportDownload;
  expect(reportFile.suggestedFilename()).toBe("pandian-stores-sales-demo.pdf");
  expect(readFileSync((await reportFile.path())!).toString("latin1")).toContain(
    "7875.00",
  );
  await page.goto("/dashboard?scope=demo");
  await expect(
    page.getByRole("heading", { name: "Owner dashboard", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Invoiced this month INR 7875\.00/ }),
  ).toBeVisible();
  const denied = await page.request.get(
    "/api/reports?kind=stock&format=csv&from=2026-11-01&to=2026-11-30&asOf=2026-11-30",
  );
  expect(denied.status()).toBe(200);
  await page.getByRole("button", { name: "Log out" }).click();
  await login("salesman.b@example.test");
  expect((await page.request.get("/api/sales?pdf=" + invoiceId)).status()).toBe(
    404,
  );
  const origin = {
    Origin: "http://localhost:3100",
    "Content-Type": "application/json",
  };
  expect(
    (
      await page.request.post("/api/sales?dispatch=forbidden", {
        headers: origin,
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/sales", {
        headers: origin,
        data: Buffer.from("{"),
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.post("/api/sales", {
        headers: origin,
        data: "x".repeat(65537),
      })
    ).status(),
  ).toBe(413);
  expect(
    (
      await page.request.post("/api/sales", {
        headers: { ...origin, Origin: "https://untrusted.example" },
        data: {},
      })
    ).status(),
  ).toBe(403);

  expect(
    (await page.request.get("/api/reports?kind=gst&format=csv")).status(),
  ).toBe(403);
  expect(
    (await page.request.get("/api/reports?kind=stock&format=pdf")).status(),
  ).toBe(403);
  expect((await page.request.get("/api/dashboard?scope=demo")).status()).toBe(
    403,
  );
  const ownReport = await page.request.get(
    "/api/reports?kind=sales&scope=demo&from=2026-11-01&to=2026-11-30&asOf=2026-11-30",
  );
  expect(ownReport.status()).toBe(200);
  expect((await ownReport.json()).rows).toHaveLength(0);

  await expect(
    page.getByRole("option", { name: "Retailer A", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  await page.getByLabel("Order quantity").fill("120");
  await page.getByRole("button", { name: "Submit order", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Distributor B — submitted" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.context().addCookies(adminCookies);
  await page.goto("/sales");
  await page.getByLabel("Review reason").fill("Final benchmark shortage check");
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(page.getByText(/shortage 32/)).toBeVisible();
  const distributor = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Distributor B — submitted" }),
  });
  await expect(
    distributor.getByRole("cell", { name: "88", exact: true }),
  ).toBeVisible();
  await expect(
    distributor.getByRole("link", { name: "Download invoice PDF" }),
  ).toHaveCount(0);
  await expect(
    distributor.getByRole("cell", {
      name: "IGST (Tamil Nadu seller)",
      exact: true,
    }),
  ).toBeVisible();
});
