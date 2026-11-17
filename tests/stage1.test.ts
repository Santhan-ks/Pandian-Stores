import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import * as s from "../src/lib/db/schema";
import { seedDemo } from "../scripts/seed-data";
import { createAuth } from "../src/modules/auth/auth";
import { listMaster, saveMaster } from "../src/modules/catalog/service";
import { getBom, publishBom } from "../src/modules/catalog/bom";
import { convert, scaleBom } from "../src/lib/units/convert";
import { schemas } from "../src/modules/catalog/validation";
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  url === process.env.DATABASE_URL ||
  !new URL(url).pathname.endsWith("_test")
)
  throw new Error("Tests require a dedicated database ending in _test.");
const pool = new Pool({ connectionString: url });
const db = drizzle(pool, { schema: s });
const password = process.env.DEMO_PASSWORD ?? randomUUID();
const auth = createAuth(
  db,
  randomUUID() + randomUUID(),
  "http://localhost:3100",
);
const admin = { id: "demo-admin", role: "admin" } as const;
const auditor = { id: "demo-auditor", role: "auditor" } as const;
beforeAll(async () => {
  await db.execute(
    sql`TRUNCATE nova.users, nova.roles, nova.units, nova.inventory_items, nova.territories RESTART IDENTITY CASCADE`,
  );
  await seedDemo(db, password);
}, 30000);
afterAll(async () => {
  await pool.end();
});
describe("authentication", () => {
  test("valid password creates a database session; wrong password fails", async () => {
    const result = await auth.api.signInEmail({
      body: { email: "admin@example.test", password },
    });
    expect(result.user.id).toBe(admin.id);
    const rows = await db
      .select()
      .from(s.session)
      .where(eq(s.session.userId, admin.id));
    expect(rows.length).toBe(1);
    await expect(
      auth.api.signInEmail({
        body: { email: "admin@example.test", password: "incorrect-password" },
      }),
    ).rejects.toThrow();
  });
  test("expired sessions and anonymous requests cannot authenticate", async () => {
    const response = await auth.api.signInEmail({
      body: { email: "owner@example.test", password },
      asResponse: true,
    });
    const cookie = response.headers.get("set-cookie")!;
    const headers = new Headers({ cookie });
    expect(await auth.api.getSession({ headers })).toBeTruthy();
    await db
      .update(s.session)
      .set({ expiresAt: new Date(0) })
      .where(eq(s.session.userId, "demo-owner"));
    expect(await auth.api.getSession({ headers })).toBeNull();
    expect(await auth.api.getSession({ headers: new Headers() })).toBeNull();
  });
});
describe("authorization and validation", () => {
  test("admin provisioning hashes passwords and role changes revoke sessions", async () => {
    const input = {
      name: "Test user",
      email: "test.user@example.test",
      role: "owner",
      password,
    };
    const created = await saveMaster(db, admin, "users", input);
    await auth.api.signInEmail({ body: { email: input.email, password } });
    const [credential] = await db
      .select()
      .from(s.account)
      .where(eq(s.account.userId, created.id));
    expect(credential.password).not.toBe(password);
    await saveMaster(
      db,
      admin,
      "users",
      { ...input, role: "auditor", password: "" },
      created.id,
    );
    expect(
      await db.select().from(s.session).where(eq(s.session.userId, created.id)),
    ).toHaveLength(0);
    const events = await db
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.documentId, created.id));
    expect(JSON.stringify(events)).not.toContain(password);
    expect(events.at(-1)?.after).toMatchObject({ role: "auditor" });
  });
  test("anonymous and auditor mutations are rejected", async () => {
    await expect(listMaster(db, null, "products")).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      saveMaster(db, auditor, "suppliers", {}),
    ).rejects.toMatchObject({ status: 403 });
    await expect(publishBom(db, auditor, {})).rejects.toMatchObject({
      status: 403,
    });
  });
  test("salesmen only see customers in their territories", async () => {
    const a = await listMaster(
      db,
      { id: "demo-salesman-a", role: "salesman" },
      "customers",
    );
    const b = await listMaster(
      db,
      { id: "demo-salesman-b", role: "salesman" },
      "customers",
    );
    expect(a.map((x) => x.id)).toEqual(["demo-retailer-a"]);
    expect(b.map((x) => x.id)).toEqual(["demo-distributor-b"]);
    await expect(
      listMaster(
        db,
        { id: "demo-salesman-a", role: "salesman" },
        "boms" as never,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  test("invalid money, quantities, missing fields and foreign keys are rejected", async () => {
    expect(
      schemas.prices.safeParse({
        productId: "x",
        amount: "1.001",
        gstPercent: "5",
      }).success,
    ).toBe(false);
    await expect(
      saveMaster(db, admin, "materials", {
        name: "",
        kind: "raw",
        baseUnit: "kg",
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(s.customers).values({
        name: "Unknown territory",
        state: "Tamil Nadu",
        address: "Test fixture",
        territoryId: "missing",
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(s.customers).values({
        name: "Retailer A",
        state: "Tamil Nadu",
        address: "Test fixture",
        territoryId: "demo-territory-a",
      }),
    ).rejects.toThrow();
  });
  test("master edits are audited and identity units cannot change", async () => {
    const material = await saveMaster(db, admin, "materials", {
      name: "Test material",
      kind: "raw",
      baseUnit: "g",
    });
    await saveMaster(
      db,
      admin,
      "materials",
      { name: "Renamed test material", kind: "raw", baseUnit: "g" },
      material.id,
    );
    expect(
      (
        await db
          .select()
          .from(s.auditEvents)
          .where(eq(s.auditEvents.documentId, material.id))
      ).length,
    ).toBe(2);
    await expect(
      saveMaster(
        db,
        admin,
        "materials",
        { name: "Test", kind: "raw", baseUnit: "ml" },
        material.id,
      ),
    ).rejects.toThrow();
  });
});
describe("units and BOMs", () => {
  test("exact conversions and batch scaling", () => {
    expect(convert("1000", "g", "kg")).toBe("1");
    expect(convert("1.2", "kg", "g")).toBe("1200");
    expect(convert("10.5", "L", "ml")).toBe("10500");
    expect(convert("9", "carton", "packet", 20)).toBe("180");
    expect(convert("200", "piece", "piece")).toBe("200");
    expect(scaleBom("40", "1", "2.5")).toBe("100");
    expect(() => convert("1", "kg", "L")).toThrow();
    expect(() => convert("1", "carton", "packet")).toThrow();
    expect(() => convert("1", "piece", "packet")).toThrow();
  });
  test("publication preserves old content and rejects direct changes", async () => {
    const before = await getBom(db, admin, "demo-bom-1");
    const revised = await publishBom(db, admin, {
      productId: before.productId,
      batchSize: "1",
      expectedOutput: "210",
      outputUnit: "packet",
      lines: before.lines.map((l) => ({
        itemId: l.itemId,
        quantity: l.quantity,
        unit: l.unit,
      })),
    });
    expect(revised.revision).toBe(2);
    const old = await getBom(db, admin, before.id);
    expect(old.expectedOutput).toBe(before.expectedOutput);
    expect(old.lines).toEqual(before.lines);
    expect(old.active).toBe(false);
    await expect(
      db
        .update(s.bomLines)
        .set({ quantity: "99" })
        .where(eq(s.bomLines.bomId, old.id)),
    ).rejects.toThrow();
    await expect(
      db.delete(s.bomVersions).where(eq(s.bomVersions.id, old.id)),
    ).rejects.toThrow();
    await expect(
      db
        .update(s.bomVersions)
        .set({ expectedOutput: "1" })
        .where(eq(s.bomVersions.id, old.id)),
    ).rejects.toThrow();
  });
  test("bad components, duplicate lines, incompatible units and nonpositive yields fail", async () => {
    const input = {
      productId: "demo-murukku",
      batchSize: "1",
      expectedOutput: "200",
      outputUnit: "packet",
      lines: [{ itemId: "demo-flour", quantity: "40", unit: "kg" }],
    };
    await expect(
      publishBom(db, admin, { ...input, expectedOutput: "0" }),
    ).rejects.toThrow();
    await expect(
      publishBom(db, admin, {
        ...input,
        lines: [...input.lines, ...input.lines],
      }),
    ).rejects.toThrow();
    for (const line of [
      { itemId: "missing", quantity: "1", unit: "kg" },
      { itemId: "demo-flour", quantity: "1", unit: "L" },
      { itemId: "demo-finished", quantity: "1", unit: "piece" },
    ])
      await expect(
        publishBom(db, admin, { ...input, lines: [line] }),
      ).rejects.toThrow();
  });
  test("seed reruns preserve edited masters, published revisions and passwords", async () => {
    const before = await db.select().from(s.account);
    const revisions = await db.select().from(s.bomVersions);
    await seedDemo(db, randomUUID());
    await seedDemo(db, randomUUID());
    expect(await db.select().from(s.account)).toEqual(before);
    expect(await db.select().from(s.bomVersions)).toEqual(revisions);
    expect(
      (await db.select().from(s.user)).filter((u) => u.id.startsWith("demo-"))
        .length,
    ).toBe(6);
    expect((await db.select().from(s.customers)).length).toBe(2);
  });
});
