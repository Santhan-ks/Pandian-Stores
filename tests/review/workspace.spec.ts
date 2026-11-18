import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { benchmarkProduction } from "../../scripts/production-fixture";

const allTabs = [
  "dashboard",
  "sales",
  "inventory",
  "production",
  "reports",
  "products",
  "prices",
  "boms",
  "users",
  "customers",
  "territories",
  "suppliers",
  "materials",
];
const allReports = [
  "sales",
  "customer_sales",
  "product_sales",
  "gst",
  "purchases",
  "stock",
  "ledger",
  "production",
  "consumption",
  "payments",
  "receivables",
  "customer_balances",
  "ageing",
  "orders",
];
const salesReports = [
  "sales",
  "customer_sales",
  "product_sales",
  "receivables",
  "customer_balances",
  "ageing",
  "orders",
];
const cases = [
  {
    email: "admin",
    role: "admin",
    tabs: allTabs,
    reports: allReports,
    width: 1440,
  },
  {
    email: "owner",
    role: "owner",
    tabs: allTabs,
    reports: allReports,
    width: 1440,
  },
  {
    email: "production",
    role: "production",
    tabs: [
      "inventory",
      "production",
      "reports",
      "products",
      "prices",
      "boms",
      "suppliers",
      "materials",
    ],
    reports: ["stock", "ledger", "production", "consumption"],
    width: 768,
  },
  {
    email: "auditor",
    role: "auditor",
    tabs: allTabs,
    reports: allReports,
    width: 1440,
  },
  {
    email: "salesman.a",
    role: "salesman",
    tabs: ["sales", "reports", "products", "prices", "customers"],
    reports: salesReports,
    width: 360,
  },
  {
    email: "salesman.b",
    role: "salesman",
    tabs: ["sales", "reports", "products", "prices", "customers"],
    reports: salesReports,
    width: 390,
  },
];
const origin = "http://localhost:3200";
const ownerSupplier = "Role review owner deletion";
const filters = new URLSearchParams({
  scope: "demo",
  from: "2026-11-01",
  to: "2026-11-30",
  asOf: "2026-11-30",
});
async function post(page: Page, path: string, data: unknown) {
  return page.request.post(path, { headers: { Origin: origin }, data });
}
async function remove(page: Page, resource: string, id: string) {
  return page.request.delete(
    "/api/records?" + new URLSearchParams({ resource, id }),
    { headers: { Origin: origin } },
  );
}
async function confirmDelete(page: Page, name: string) {
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Delete " + name, exact: true })
    .click();
}

for (const person of cases) {
  test(`${person.email}: all permitted tabs, report options, exports and sample actions`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width: person.width, height: 900 });
    expect((await page.request.get("/api/masters/products")).status()).toBe(
      401,
    );
    await page.goto("/login");
    await page.getByLabel("Email").fill(person.email + "@example.test");
    await page
      .getByLabel("Password", { exact: true })
      .fill(process.env.DEMO_PASSWORD!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/products$/);
    for (const tab of allTabs) {
      const nav = page
        .getByRole("navigation", { name: "Main navigation" })
        .locator(`a[href="/${tab}"]`);
      await expect(nav).toHaveCount(person.tabs.includes(tab) ? 1 : 0);
      const path = [
        "dashboard",
        "sales",
        "inventory",
        "production",
        "boms",
      ].includes(tab)
        ? "/api/" + tab
        : tab === "reports"
          ? "/api/reports?kind=" + person.reports[0]
          : "/api/masters/" + tab;
      expect(
        (await page.request.get(path)).status(),
        person.email + " " + tab,
      ).toBe(person.tabs.includes(tab) ? 200 : 403);
      if (!person.tabs.includes(tab)) continue;
      await nav.click();
      await expect(page).toHaveURL(new RegExp("/" + tab + "(?:\\?|$)"));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        tab + " fits viewport",
      ).toBe(true);
      if (!["admin", "owner"].includes(person.role))
        await expect(
          page.getByRole("button", { name: /^Delete / }),
        ).toHaveCount(0);
      if (tab === "products") {
        await expect(page.locator(".product-card")).toHaveCount(5);
        await expect(
          page.getByText("Needs price and BOM configuration", { exact: true }),
        ).toHaveCount(4);
        for (const image of await page.locator(".product-card img").all()) {
          // Native lazy loading may wait until an image approaches the viewport.
          await image.scrollIntoViewIfNeeded();
          await expect(image).toBeVisible();
          await expect
            .poll(() =>
              image.evaluate(
                (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
              ),
            )
            .toBe(true);
        }
        if (person.role === "admin")
          await page.screenshot({
            path: "test-results/review-catalogue.png",
            fullPage: true,
          });
      }
      if (
        ["admin", "owner"].includes(person.role) &&
        ["inventory", "production", "boms"].includes(tab)
      ) {
        const controls = page.locator(".delete-button");
        expect(await controls.count()).toBeGreaterThan(0);
        for (const control of await controls.all())
          await expect(control).toBeDisabled();
      }
      if (tab === "boms") {
        await page
          .getByRole("link", {
            name: "Murukku 200 g — Revision 1",
            exact: true,
          })
          .click();
        await expect(
          page.getByRole("heading", { name: "BOM revision 1", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Publish BOM", exact: true }),
        ).toHaveCount(["admin", "production"].includes(person.role) ? 1 : 0);
      }
      if (tab === "dashboard") {
        await page
          .getByRole("combobox", {
            name: "Financial invoice scope",
            exact: true,
          })
          .selectOption("demo");
        await page.getByRole("button", { name: "Apply scope" }).click();
        await expect(
          page.getByText("INR 3875.00", { exact: true }).first(),
        ).toBeVisible();
        for (const link of await page.locator(".metric-card").all()) {
          expect(
            (
              await page.request.get((await link.getAttribute("href"))!)
            ).status(),
          ).toBe(200);
        }
      }
    }
    for (const kind of allReports) {
      const response = await page.request.get(
        "/api/reports?kind=" + kind + "&" + filters,
      );
      expect(response.status(), person.email + " report " + kind).toBe(
        person.reports.includes(kind) ? 200 : 403,
      );
    }
    await page.goto("/reports");
    await expect(
      page.getByRole("combobox", { name: "Report", exact: true }),
    ).toBeVisible();
    const options = await page
      .getByRole("combobox", { name: "Report", exact: true })
      .locator("option")
      .evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value));
    expect(options.sort()).toEqual([...person.reports].sort());
    for (const kind of person.reports) {
      await page
        .getByRole("combobox", { name: "Report", exact: true })
        .selectOption(kind);
      await page
        .getByRole("combobox", { name: "Invoice scope", exact: true })
        .selectOption("demo");
      await page.getByLabel("From (inclusive)").fill("2026-11-01");
      await page.getByLabel("To (inclusive)").fill("2026-11-30");
      await page.getByLabel("As of (inclusive)").fill("2026-11-30");
      await page
        .getByRole("button", { name: "Run report", exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp("[?&]kind=" + kind + "&"));
      await expect(
        page.getByRole("heading", { level: 2 }).first(),
      ).toBeVisible();
      for (const format of ["CSV", "PDF"]) {
        const pending = page.waitForEvent("download");
        await page
          .getByRole("link", { name: "Download " + format, exact: true })
          .click();
        const download = await pending;
        expect(await download.failure()).toBeNull();
        expect(download.suggestedFilename()).toBe(
          `pandian-stores-${kind}-demo.${format.toLowerCase()}`,
        );
      }
    }
    if (person.role === "admin") {
      // Exercise a whole directory form lifecycle, confirmation cancellation and deletion.
      await page.goto("/suppliers");
      await page.getByLabel("Name", { exact: true }).fill("Review supplier");
      await page.getByLabel("State", { exact: true }).fill("Tamil Nadu");
      await page
        .getByLabel("Address", { exact: true })
        .fill("Fictional review address");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      let row = page.getByRole("row").filter({
        has: page.getByRole("cell", { name: "Review supplier", exact: true }),
      });
      await row.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByRole("button", { name: "Cancel edit" }).click();
      await row.getByRole("button", { name: "Edit", exact: true }).click();
      await page
        .getByLabel("Name", { exact: true })
        .fill("Review supplier updated");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      row = page.getByRole("row").filter({
        has: page.getByRole("cell", {
          name: "Review supplier updated",
          exact: true,
        }),
      });
      await expect(row).toBeVisible();
      await page.getByLabel("Search records").fill("no-such-record");
      await expect(
        page.getByText("No records match your search."),
      ).toBeVisible();
      await page.getByLabel("Search records").fill("Review supplier updated");
      page.once("dialog", (d) => d.dismiss());
      await row
        .getByRole("button", {
          name: "Delete Review supplier updated",
          exact: true,
        })
        .click();
      await expect(row).toBeVisible();
      await confirmDelete(page, "Review supplier updated");
      await expect(
        page.getByRole("cell", {
          name: "Review supplier updated",
          exact: true,
        }),
      ).toHaveCount(0);
      expect(
        (
          await post(page, "/api/masters/suppliers", {
            name: ownerSupplier,
            state: "Tamil Nadu",
            address: "Fictional owner deletion test",
          })
        ).ok(),
      ).toBe(true);
      expect(
        (
          await page.request.delete(
            "/api/records?resource=users&id=demo-owner",
            { headers: { Origin: "https://untrusted.example" } },
          )
        ).status(),
      ).toBe(403);
      expect((await remove(page, "users", "demo-admin")).status()).toBe(409);
      // Delete an actively edited draft, then save a genuinely new draft.
      const reason = "Review removable draft";
      await page.goto("/inventory");
      await page
        .getByRole("combobox", { name: "Document type", exact: true })
        .selectOption("adjustment");
      await page.getByLabel("Reason / reference").fill(reason);
      await page
        .getByRole("combobox", { name: "Inventory item", exact: true })
        .selectOption("demo-flour");
      await page.getByLabel("Signed quantity change").fill("-1");
      await page
        .getByRole("combobox", { name: "Unit", exact: true })
        .selectOption("kg");
      await page.getByRole("button", { name: "Add line" }).click();
      await page.getByRole("button", { name: "Remove line" }).last().click();
      await page
        .getByRole("button", { name: "Save draft", exact: true })
        .click();
      const draft = page
        .locator("details")
        .filter({ has: page.locator("summary", { hasText: reason }) });
      await draft.locator("summary").click();
      await draft
        .getByRole("button", { name: "Edit draft", exact: true })
        .click();
      await confirmDelete(page, reason);
      await expect(draft).toHaveCount(0);
      await page
        .getByLabel("Reason / reference")
        .fill("Review new draft after deletion");
      await page
        .getByRole("button", { name: "Save draft", exact: true })
        .click();
      await expect(
        page.locator("summary", { hasText: "Review new draft after deletion" }),
      ).toHaveCount(1);
      const documents = await (await page.request.get("/api/inventory")).json();
      const created = documents.documents.find(
        (d: { reason: string }) =>
          d.reason === "Review new draft after deletion",
      );
      expect((await remove(page, "stock", created.id)).status()).toBe(200);
    } else if (person.role === "owner") {
      await page.goto("/suppliers");
      await expect(
        page.getByRole("button", { name: "Save", exact: true }),
      ).toHaveCount(0);
      await confirmDelete(page, ownerSupplier);
      await expect(
        page.getByRole("cell", { name: ownerSupplier, exact: true }),
      ).toHaveCount(0);
      expect(
        (
          await post(page, "/api/masters/suppliers", {
            name: "Forbidden",
            state: "Tamil Nadu",
            address: "Fictional",
          })
        ).status(),
      ).toBe(403);
      expect((await remove(page, "users", "demo-admin")).status()).toBe(409);
      expect((await remove(page, "boms", "demo-bom-1")).status()).toBe(409);
    } else {
      expect((await remove(page, "products", "demo-murukku")).status()).toBe(
        403,
      );
      expect((await post(page, "/api/masters/users", {})).status()).toBe(403);
      if (person.role === "production") {
        const saved = await post(
          page,
          "/api/production",
          benchmarkProduction("review-draft-" + randomUUID()),
        );
        expect(saved.status()).toBe(200);
        await page.goto("/production");
        await page
          .locator("details summary")
          .filter({ hasText: "draft" })
          .click();
        await expect(
          page.getByRole("button", {
            name: "Edit production draft",
            exact: true,
          }),
        ).toHaveCount(1);
        await page
          .getByRole("button", { name: "Edit production draft", exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name: "Edit draft production run" }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Cancel edit", exact: true })
          .click();
      } else if (person.role === "salesman") {
        const mine = person.email.endsWith("a")
          ? "Retailer A"
          : "Distributor B";
        const other = mine === "Retailer A" ? "Distributor B" : "Retailer A";
        await page.goto("/customers");
        await expect(
          page.getByRole("cell", { name: mine, exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("cell", { name: other, exact: true }),
        ).toHaveCount(0);
        await page.goto("/sales");
        await expect(
          page
            .getByRole("combobox", { name: "Customer", exact: true })
            .locator("option"),
        ).toHaveCount(1);
        await expect(
          page
            .getByRole("combobox", { name: "Product", exact: true })
            .locator("option"),
        ).toHaveCount(1);
        await page
          .getByRole("button", { name: "Add product", exact: true })
          .click();
        await page.getByRole("button", { name: "Remove", exact: true }).click();
        await expect(
          page.getByRole("button", { name: "Submit order", exact: true }),
        ).toBeDisabled();
        await page
          .getByRole("button", { name: "Add product", exact: true })
          .click();
        await page.getByLabel("Order quantity", { exact: true }).fill("1");
        await page
          .getByRole("button", { name: "Submit order", exact: true })
          .click();
        await expect(page.getByRole("status")).toHaveText("Saved.");
        const orders = await (await page.request.get("/api/sales")).json();
        expect(
          orders.orders.every((o: { customer: string }) => o.customer === mine),
        ).toBe(true);
        expect(
          (
            await post(page, "/api/sales", {
              customerId:
                mine === "Retailer A"
                  ? "demo-distributor-b"
                  : "demo-retailer-a",
              requestKey: randomUUID(),
              lines: [{ productId: "demo-murukku", quantity: "1", rate: "50" }],
            })
          ).status(),
        ).toBe(403);
      } else {
        expect((await post(page, "/api/sales?payment=1", {})).status()).toBe(
          403,
        );
      }
    }
    await page.screenshot({
      path: `test-results/review-${person.email}.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await page.request.get("/api/masters/products")).status()).toBe(
      401,
    );
  });
}
