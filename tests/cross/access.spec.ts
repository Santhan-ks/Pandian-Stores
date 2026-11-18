import {
  test,
  expect,
  request,
  type APIRequestContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { benchmarkProduction } from "../../scripts/production-fixture";
import { exerciseInvoice, exerciseProfile } from "../../scripts/sales-fixture";

const origin = "http://localhost:3400";
const accounts = [
  "admin",
  "owner",
  "production",
  "auditor",
  "salesman.a",
  "salesman.b",
] as const;
type Account = (typeof accounts)[number];
type Operation = {
  label: string;
  path: string;
  method?: "POST" | "DELETE";
  data?: unknown;
  allowed: Account[];
};
const sessions = new Map<Account, APIRequestContext>();
const client = (account: Account) => sessions.get(account)!;
const adminOnly: Account[] = ["admin"];
const factory: Account[] = ["admin", "production"];
const sellers: Account[] = ["admin", "salesman.a", "salesman.b"];

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  for (const account of accounts) {
    const api = await request.newContext({ baseURL: origin });
    const login = await api.post("/api/auth/sign-in/email", {
      headers: { Origin: origin },
      data: {
        email: account + "@example.test",
        password: process.env.DEMO_PASSWORD,
      },
    });
    expect(login.status(), account + " signs in").toBe(200);
    sessions.set(account, api);
  }
});
test.afterAll(async () => {
  for (const api of sessions.values()) {
    await api.post("/api/auth/sign-out", {
      headers: { Origin: origin },
      data: {},
    });
    await api.dispose();
  }
});

async function state() {
  const api = client("admin");
  return {
    inventory: await (await api.get("/api/inventory")).json(),
    production: await (await api.get("/api/production")).json(),
    sales: await (await api.get("/api/sales")).json(),
    masters: await Promise.all(
      [
        "users",
        "customers",
        "territories",
        "suppliers",
        "materials",
        "products",
        "prices",
      ].map(async (key) => (await api.get("/api/masters/" + key)).json()),
    ),
    boms: await (await api.get("/api/boms")).json(),
    billing: await (await api.get("/api/billing")).json(),
  };
}

async function operations(): Promise<Operation[]> {
  const current = await state();
  const first = current.sales.orders.find(
    (o: { customer_id: string }) => o.customer_id === "demo-retailer-a",
  );
  const opening = current.inventory.documents.find(
    (d: { category: string }) => d.category === "opening",
  );
  const purchase = current.inventory.documents.find(
    (d: { category: string }) => d.category === "purchase",
  );
  const run = current.production[0];
  const order = {
    customerId: "demo-retailer-a",
    requestKey: randomUUID(),
    lines: [{ productId: "demo-murukku", quantity: "1", rate: "50.00" }],
  };
  const inventory = {
    category: "opening",
    supplierId: null,
    reason: "Cross-role test only",
    requestKey: randomUUID(),
    lines: [
      { itemId: "demo-flour", quantity: "1", unit: "kg", unitRate: "42" },
    ],
  };
  return [
    {
      label: "user administration",
      path: "/api/masters/users",
      allowed: adminOnly,
      data: {
        name: "Cross test",
        email: "cross-test@example.test",
        role: "auditor",
        password: process.env.DEMO_PASSWORD,
      },
    },
    {
      label: "customer creation",
      path: "/api/masters/customers",
      allowed: adminOnly,
      data: {
        name: "Cross customer",
        state: "Tamil Nadu",
        address: "Fictional test address",
        territoryId: "demo-territory-a",
      },
    },
    {
      label: "territory assignment",
      path: "/api/masters/territories",
      allowed: adminOnly,
      data: { name: "Cross territory", salesmanId: "demo-salesman-a" },
    },
    {
      label: "supplier creation",
      path: "/api/masters/suppliers",
      allowed: factory,
      data: {
        name: "Cross supplier",
        state: "Tamil Nadu",
        address: "Fictional test address",
      },
    },
    {
      label: "material creation",
      path: "/api/masters/materials",
      allowed: factory,
      data: { name: "Cross material", kind: "raw", baseUnit: "g" },
    },
    {
      label: "product creation",
      path: "/api/masters/products",
      allowed: adminOnly,
      data: { name: "Cross pack", packGrams: "200", cartonCapacity: 20 },
    },
    {
      label: "price editing",
      path: "/api/masters/prices?id=demo-price",
      allowed: adminOnly,
      data: { productId: "demo-murukku", amount: "50", gstPercent: "5" },
    },
    {
      label: "BOM publishing",
      path: "/api/boms",
      allowed: factory,
      data: {
        productId: "demo-murukku",
        batchSize: "1",
        expectedOutput: "200",
        outputUnit: "packet",
        lines: [{ itemId: "demo-flour", quantity: "40", unit: "kg" }],
      },
    },
    {
      label: "opening stock",
      path: "/api/inventory",
      allowed: adminOnly,
      data: inventory,
    },
    {
      label: "purchase receipt",
      path: "/api/inventory",
      allowed: factory,
      data: {
        ...inventory,
        category: "purchase",
        supplierId: purchase.supplier_id,
      },
    },
    {
      label: "stock adjustment",
      path: "/api/inventory",
      allowed: adminOnly,
      data: {
        ...inventory,
        category: "adjustment",
        lines: [{ ...inventory.lines[0], quantity: "-1", unitRate: null }],
      },
    },
    {
      label: "stock posting",
      path: "/api/inventory?post=" + opening.id,
      allowed: adminOnly,
      data: {},
    },
    {
      label: "production creation",
      path: "/api/production",
      allowed: factory,
      data: benchmarkProduction(randomUUID()),
    },
    {
      label: "production posting",
      path: "/api/production?post=" + run.id,
      allowed: factory,
      data: {},
    },
    {
      label: "production overhead",
      path: "/api/production?overhead=" + run.id,
      allowed: factory,
      data: {
        category: "labour",
        amount: "1",
        reason: "Cross-test overhead",
        requestKey: randomUUID(),
      },
    },
    { label: "order entry", path: "/api/sales", allowed: sellers, data: order },
    {
      label: "order review",
      path: "/api/sales?review=" + first.id,
      allowed: adminOnly,
      data: { decision: "approve", reason: "Cross-test review" },
    },
    {
      label: "real invoice",
      path: "/api/sales?invoice=" + first.id,
      allowed: adminOnly,
      data: exerciseInvoice,
    },
    {
      label: "sample invoice",
      path: "/api/sales?demoInvoice=" + first.id,
      allowed: adminOnly,
      data: exerciseInvoice,
    },
    {
      label: "dispatch",
      path: "/api/sales?dispatch=" + first.id,
      allowed: adminOnly,
      data: {},
    },
    {
      label: "credit",
      path: "/api/sales?credit=" + first.invoice_id,
      allowed: adminOnly,
      data: { reason: "Cross-test credit" },
    },
    {
      label: "payment",
      path: "/api/sales?payment",
      allowed: adminOnly,
      data: {
        customerId: "demo-retailer-a",
        date: "2026-11-18",
        reference: "Cross-test payment",
        method: "bank",
        amount: "1",
        requestKey: randomUUID(),
        allocations: [{ invoiceId: first.invoice_id, amount: "1" }],
      },
    },
    {
      label: "billing configuration",
      path: "/api/billing",
      allowed: adminOnly,
      data: exerciseProfile,
    },
    {
      label: "record deletion",
      path: "/api/records?resource=products&id=demo-murukku",
      method: "DELETE",
      allowed: ["admin", "owner"],
    },
  ];
}

test("cross-role mutation matrix rejects unauthorized roles without business side effects", async () => {
  const before = await state();
  let checked = 0;
  for (const operation of await operations()) {
    for (const account of accounts) {
      if (operation.allowed.includes(account)) continue;
      const response = await client(account).fetch(operation.path, {
        method: operation.method ?? "POST",
        data: operation.data,
        headers: { Origin: origin },
      });
      expect(response.status(), account + ": " + operation.label).toBe(403);
      checked++;
    }
  }
  expect(await state()).toEqual(before);
  console.log(
    `Cross-role mutation denials: ${checked}; business state unchanged.`,
  );
});

test("cross-salesman identifiers, reports, PDFs and actor spoofing cannot escape scope", async () => {
  const before = await state();
  const first = before.sales.orders.find(
    (o: { customer_id: string }) => o.customer_id === "demo-retailer-a",
  );
  for (const [account, own, other, foreignSalesman] of [
    ["salesman.a", "demo-retailer-a", "demo-distributor-b", "demo-salesman-b"],
    ["salesman.b", "demo-distributor-b", "demo-retailer-a", "demo-salesman-a"],
  ] as const) {
    const api = client(account);
    const customers = await (await api.get("/api/masters/customers")).json();
    expect(customers.map((c: { id: string }) => c.id)).toEqual([own]);
    const ownHistory = await (
      await api.get("/api/sales?role=admin&userId=demo-admin")
    ).json();
    expect(
      ownHistory.orders.every(
        (o: { customer_id: string }) => o.customer_id === own,
      ),
    ).toBe(true);
    expect(
      (await api.get("/api/reports?kind=sales&customer=" + other)).status(),
    ).toBe(403);
    expect(
      (
        await api.get("/api/reports?kind=orders&salesman=" + foreignSalesman)
      ).status(),
    ).toBe(403);
    const payload = {
      customerId: other,
      requestKey: randomUUID(),
      lines: [{ productId: "demo-murukku", quantity: "1", rate: "50" }],
    };
    expect(
      (
        await api.post("/api/sales", {
          headers: { Origin: origin },
          data: payload,
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await api.post("/api/sales", {
          headers: { Origin: origin },
          data: {
            ...payload,
            customerId: own,
            role: "admin",
            salesmanId: "demo-admin",
          },
        })
      ).status(),
    ).toBe(422);
    expect(
      (
        await api.post("/api/sales", {
          headers: { Origin: origin },
          data: {
            ...payload,
            customerId: own,
            lines: [{ ...payload.lines[0], rate: "1" }],
          },
        })
      ).status(),
    ).toBe(422);
  }
  expect(
    (
      await client("salesman.b").get(
        "/api/sales?pdf=" + first.invoice_id + "&role=admin",
      )
    ).status(),
  ).toBe(404);
  const permitted = await client("salesman.a").get(
    "/api/sales?pdf=" + first.invoice_id,
  );
  expect(permitted.status()).toBe(200);
  expect(permitted.headers()["content-type"]).toBe("application/pdf");
  expect(await state()).toEqual(before);
});

test("all mutation endpoints reject foreign, missing, null and lookalike origins", async () => {
  const before = await state();
  let checked = 0;
  for (const operation of await operations()) {
    for (const attackOrigin of [
      undefined,
      "null",
      "https://untrusted.example",
      origin + ".untrusted.example",
    ]) {
      const response = await client("admin").fetch(operation.path, {
        method: operation.method ?? "POST",
        data: operation.data,
        headers: attackOrigin ? { Origin: attackOrigin } : {},
      });
      expect(response.status(), operation.label + ": " + attackOrigin).toBe(
        403,
      );
      checked++;
    }
  }
  expect(
    (
      await client("admin").post("/api/auth/sign-out", {
        headers: { Origin: "https://untrusted.example" },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect((await client("admin").get("/api/masters/users")).status()).toBe(200);
  expect(await state()).toEqual(before);
  console.log(
    `Cross-origin mutation denials: ${checked + 1}; admin session and business state preserved.`,
  );
});

test("cross-module replay, invoice-mode changes and protected deletion retain ledger and balances", async () => {
  const before = await state();
  const api = client("admin");
  const first = before.sales.orders.find(
    (o: { customer_id: string }) => o.customer_id === "demo-retailer-a",
  );
  const payment = before.sales.payments[0];
  const run = before.production[0];
  const post = (path: string, data: unknown) =>
    api.post(path, { headers: { Origin: origin }, data });
  expect((await post("/api/sales?dispatch=" + first.id, {})).status()).toBe(
    200,
  );
  expect(
    (
      await post("/api/sales?demoInvoice=" + first.id, exerciseInvoice)
    ).status(),
  ).toBe(200);
  expect(
    (await post("/api/sales?invoice=" + first.id, exerciseInvoice)).status(),
  ).toBe(409);
  expect((await post("/api/sales?payment", payment.payload)).status()).toBe(
    200,
  );
  expect(
    (
      await post("/api/sales?payment", {
        ...payment.payload,
        reference: "Conflicting payment replay",
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await post("/api/sales?credit=" + first.invoice_id, {
        reason: "Paid invoice credit attempt",
      })
    ).status(),
  ).toBe(409);
  for (const [resource, id] of [
    ["invoices", first.invoice_id],
    ["payments", payment.id],
    ["production", run.id],
    ["products", "demo-murukku"],
    ["users", "demo-admin"],
  ]) {
    expect(
      (
        await api.delete(
          "/api/records?" + new URLSearchParams({ resource, id }),
          { headers: { Origin: origin } },
        )
      ).status(),
      resource,
    ).toBe(409);
  }
  expect(
    (
      await client("owner").delete(
        "/api/records?resource=users&id=demo-admin",
        { headers: { Origin: origin } },
      )
    ).status(),
  ).toBe(409);
  const after = await state();
  expect(after).toEqual(before);
  expect(
    Number(
      after.inventory.summary.find(
        (r: { id: string }) => r.id === "demo-finished",
      ).quantity,
    ),
  ).toBe(88);
  expect(first.outstanding).toBe("3875.00");
  expect(first.snapshot.lines[0]).toMatchObject({
    taxable: "7500.00",
    cgst: "187.50",
    sgst: "187.50",
    igst: "0.00",
    total: "7875.00",
  });
});

test("shared-browser logout and role switching do not retain the other salesman's view", async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: await client("salesman.a").storageState(),
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await context.newPage();
    await page.goto("/sales");
    await expect(
      page.getByRole("heading", {
        name: "Retailer A — dispatched",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("Email").fill("salesman.b@example.test");
    await page
      .getByLabel("Password", { exact: true })
      .fill(process.env.DEMO_PASSWORD!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/products$/);
    await page.goto("/sales");
    await expect(
      page.getByRole("heading", {
        name: "Distributor B — submitted",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: /Retailer A/ })).toHaveCount(
      0,
    );
    await page.goto("/customers");
    await expect(
      page.getByRole("cell", { name: "Distributor B", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "Retailer A", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
  } finally {
    await context.close();
  }
});
