import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("tax preview follows selected seller profiles and preserves posted invoice state", async ({
  page,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/products/);

  async function profile(state: "Tamil Nadu" | "Karnataka") {
    const response = await page.request.post("/api/billing", {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        mode: "demo",
        name: "Pandian Stores (fictional preview test)",
        address: "Invented exercise seller address",
        state,
        gstin: "DEMO-NOT-A-GSTIN",
        products: [{ productId: "demo-murukku", hsn: "1905" }],
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
  await profile("Tamil Nadu");
  const ids: string[] = [];
  for (const customerId of ["demo-retailer-a", "demo-distributor-b"]) {
    const response = await page.request.post("/api/sales", {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        customerId,
        requestKey: randomUUID(),
        lines: [{ productId: "demo-murukku", quantity: "1", rate: "50.00" }],
      },
    });
    expect(response.ok()).toBe(true);
    ids.push((await response.json()).id);
  }
  await page.goto("/sales");
  const retailer = page
    .locator("section")
    .filter({ hasText: "Order " + ids[0] });
  const distributor = page
    .locator("section")
    .filter({ hasText: "Order " + ids[1] });
  await expect(
    retailer.getByRole("cell", {
      name: "CGST + SGST (Tamil Nadu seller)",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    distributor.getByRole("cell", {
      name: "IGST (Tamil Nadu seller)",
      exact: true,
    }),
  ).toBeVisible();
  await retailer
    .getByRole("combobox", { name: "Invoice mode", exact: true })
    .selectOption("real");
  await expect(
    retailer.getByText("Configure the real seller profile to preview tax.", {
      exact: true,
    }),
  ).toBeVisible();
  await retailer
    .getByRole("combobox", { name: "Invoice mode", exact: true })
    .selectOption("demo");

  await profile("Karnataka");
  await page.reload();
  await expect(
    retailer.getByRole("cell", {
      name: "IGST (Karnataka seller)",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    distributor.getByRole("cell", {
      name: "CGST + SGST (Karnataka seller)",
      exact: true,
    }),
  ).toBeVisible();
  await retailer
    .getByLabel("Review reason")
    .fill("Configured seller preview checked");
  await retailer
    .getByRole("button", { name: "Save review", exact: true })
    .click();
  await expect(
    retailer.getByRole("heading", {
      name: "Retailer A — approved",
      exact: true,
    }),
  ).toBeVisible();
  await retailer
    .getByRole("button", { name: "Issue invoice", exact: true })
    .click();
  await expect(retailer.getByText(/Outstanding INR 52.5/)).toBeVisible();
  const data = await (await page.request.get("/api/sales")).json();
  const snapshot = data.orders.find(
    (order: { id: string }) => order.id === ids[0],
  ).snapshot;
  expect(snapshot.seller.state).toBe("Karnataka");
  expect(snapshot.lines[0]).toMatchObject({
    igst: "2.50",
    cgst: "0.00",
    sgst: "0.00",
  });
  await profile("Tamil Nadu");
  await page.reload();
  await expect(
    retailer.getByRole("cell", {
      name: "IGST (Karnataka seller)",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    distributor.getByRole("cell", {
      name: "IGST (Tamil Nadu seller)",
      exact: true,
    }),
  ).toBeVisible();
});
