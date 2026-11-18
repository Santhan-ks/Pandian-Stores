import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
});
test("production supervisor posts benchmark and adds overheads; auditor sees read-only costs", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("production@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/products/);
  await page.goto("/production");
  await page
    .getByRole("combobox", { name: "Finished product", exact: true })
    .selectOption("demo-murukku");
  await page
    .getByRole("combobox", { name: "Published BOM revision", exact: true })
    .selectOption("demo-bom-1");
  await page.getByLabel("Accepted good packets").fill("188");
  await page
    .getByRole("group", { name: "Cooking oil", exact: true })
    .getByLabel("Total consumed", { exact: true })
    .fill("10.5");
  const pouches = page.getByRole("group", {
    name: "200 g pouches",
    exact: true,
  });
  await pouches.getByLabel("Total consumed", { exact: true }).fill("194");
  await pouches
    .getByLabel("Damaged / wasted (included)", { exact: true })
    .fill("6");
  await page
    .getByRole("group", { name: "Cartons", exact: true })
    .getByLabel("Total consumed", { exact: true })
    .fill("9");
  await page
    .getByRole("button", { name: "Save production draft", exact: true })
    .click();
  const run = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "Murukku 200 g" }) });
  await run.locator("summary").click();
  await page.route(
    "**/api/production?post=*",
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await run
    .getByRole("button", { name: "Post production", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await run
    .getByRole("button", { name: "Post production", exact: true })
    .click();
  await expect(run.locator("summary")).toContainText("posted");
  await run
    .getByRole("combobox", { name: "Overhead category", exact: true })
    .selectOption("labour");
  await run.getByLabel("Amount (INR)", { exact: true }).fill("1200");
  await run
    .getByLabel("Overhead reason", { exact: true })
    .fill("Browser benchmark labour");
  await run.getByRole("button", { name: "Add overhead", exact: true }).click();
  await expect(run.getByText(/Run total: INR 5255.00/)).toBeVisible();
  await run
    .getByRole("combobox", { name: "Overhead category", exact: true })
    .selectOption("gas_power");
  await run.getByLabel("Amount (INR)", { exact: true }).fill("600");
  await run
    .getByLabel("Overhead reason", { exact: true })
    .fill("Browser benchmark gas");
  await run.getByRole("button", { name: "Add overhead", exact: true }).click();
  await expect(run.getByText(/Run total: INR 5855.00/)).toBeVisible();
  await expect(run.getByText(/Cost per good packet: INR 31.14/)).toBeVisible();
  await expect(
    run.getByText(/Estimated margin per packet.*18.86.*37.71/),
  ).toBeVisible();
  await expect(run.getByText(/Yield variance: -6%/)).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/login/);
  await page.getByLabel("Email").fill("auditor@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/products/);
  await page.goto("/production");
  await page.locator("details summary").click();
  await expect(page.getByText(/Cost per good packet: INR 31.14/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add overhead", exact: true }),
  ).toHaveCount(0);
});
