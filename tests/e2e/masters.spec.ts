import { test, expect } from "@playwright/test";
test("mobile salesman can see only assigned customers and logout", async ({
  page,
}) => {
  await page.goto("/customers");
  await expect(page).toHaveURL(/login/);
  await page.getByLabel("Email").fill("salesman.a@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/products/);
  await page.getByRole("link", { name: "Customers", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "Retailer A", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Distributor B", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/login/);
});
test("admin creates supplier and publishes a new BOM revision", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/products/);
  await page.getByRole("link", { name: "Suppliers", exact: true }).click();

  const name = "Browser test supplier " + Date.now();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("State", { exact: true }).fill("Tamil Nadu");
  await page
    .getByLabel("Address", { exact: true })
    .fill("Invented browser test address");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
  await page.getByRole("link", { name: "BOMs", exact: true }).click();
  await page
    .getByRole("link", { name: "Murukku 200 g — Revision 1", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "BOM revision 1", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Expected good packets").fill("205");
  await page.getByRole("button", { name: "Publish BOM", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(
    "BOM revision 1",
  );
  await expect(page.getByText(/205(?:\.0+)? expected packets/)).toBeVisible();
  await page.goto("/boms/demo-bom-1");
  await expect(page.getByText(/200(?:\.0+)? expected packets/)).toBeVisible();
});
test("auditor views BOMs without publication controls", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("auditor@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/products/);
  await page.goto("/boms/demo-bom-1");
  await expect(
    page.getByRole("heading", { name: "BOM revision 1", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Publish BOM", exact: true }),
  ).toHaveCount(0);
});
