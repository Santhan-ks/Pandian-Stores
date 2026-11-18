import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
});

test("admin posts opening stock and a purchase through inventory forms", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/products/);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(
    page.getByRole("link", { name: "Pandian Stores home" }),
  ).toBeVisible();
  const productImage = page.getByRole("img", {
    name: "Golden spiral murukku on a black plate",
  });
  await expect(productImage).toBeVisible();
  await expect
    .poll(() =>
      productImage.evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: "test-results/pandian-products-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const material = "Browser flour " + Date.now();
  await page.goto("/materials");
  await page.getByLabel("Name", { exact: true }).fill(material);
  await page
    .getByRole("combobox", { name: "Kind", exact: true })
    .selectOption("raw");
  await page
    .getByRole("combobox", { name: "Base unit", exact: true })
    .selectOption("g");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: material, exact: true }),
  ).toBeVisible();
  await page.goto("/inventory");
  await expect(
    page.getByRole("heading", { name: "Inventory", exact: true }),
  ).toBeVisible();
  const reason = "Browser opening " + Date.now();
  await page
    .getByRole("combobox", { name: "Document type", exact: true })
    .selectOption("opening");
  await page.getByLabel("Reason / reference").fill(reason);
  await page
    .getByRole("combobox", { name: "Inventory item", exact: true })
    .selectOption({ label: material });
  await page.getByLabel("Quantity", { exact: true }).fill("100");
  await page
    .getByRole("combobox", { name: "Unit", exact: true })
    .selectOption("kg");
  await page.getByLabel("INR per selected unit (blank = unknown)").fill("42");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const document = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: reason }) });
  await document.locator("summary").click();
  await document.getByRole("button", { name: "Post document" }).click();
  await expect(document.locator("summary")).toContainText("posted");
  await page
    .getByRole("combobox", { name: "Document type", exact: true })
    .selectOption("purchase");
  await page
    .getByRole("combobox", { name: "Supplier", exact: true })
    .selectOption({ index: 1 });
  const purchase = "Browser purchase " + Date.now();
  await page.getByLabel("Reason / reference").fill(purchase);
  await page.getByLabel("Quantity", { exact: true }).fill("60");
  await page.getByLabel("INR per selected unit (blank = unknown)").fill("45");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const receipt = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: purchase }) });
  await receipt.locator("summary").click();
  await receipt.getByRole("button", { name: "Post document" }).click();
  await expect(receipt.locator("summary")).toContainText("posted");
  const row = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: material, exact: true }) });
  await expect(row).toContainText("160000");
  await expect(row).toContainText("6900.00");
});

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
