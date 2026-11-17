import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { productionFixture } from "../../scripts/production-fixture";
import * as schema from "../../src/lib/db/schema";
test("mobile order to approval, invoice PDF, dispatch, partial collection and auditor view", async ({
  page,
}) => {
  execFileSync(process.execPath, ["--import", "tsx", "scripts/prepare-e2e.ts"]);
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
  await expect(
    page.getByRole("option", { name: "Distributor B", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  await page.getByLabel("Order quantity").fill("150");
  await page.getByRole("button", { name: "Submit order", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Retailer A — submitted" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();
  await login("admin@example.test");
  await page.getByLabel("Review reason").fill("Benchmark stock verified");
  await page.getByRole("button", { name: "Save review" }).click();
  await expect(
    page.getByRole("heading", { name: "Retailer A — approved" }),
  ).toBeVisible();
  await page.getByLabel("Seller name").fill("Exercise-only manufacturer");
  await page
    .getByLabel("Seller address")
    .fill("Invented exercise address, Tamil Nadu");
  await page
    .getByLabel("Seller GSTIN", { exact: true })
    .fill("33AAAAA0000A1Z5");
  await page.getByLabel("HSN", { exact: true }).fill("1905");
  await page
    .getByRole("button", { name: "Issue invoice", exact: true })
    .click();
  await expect(page.getByText(/Outstanding INR 7875/)).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download invoice PDF" }).click();
  expect((await download).suggestedFilename()).toBe("invoice.pdf");
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
  await page.getByRole("button", { name: "Log out" }).click();
  await login("auditor@example.test");
  await expect(page.getByText(/Outstanding INR 3875/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Record payment", exact: true }),
  ).toHaveCount(0);
});
