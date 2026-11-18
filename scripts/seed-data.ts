import { hashPassword } from "better-auth/crypto";
import { eq, sql } from "drizzle-orm";
import * as s from "../src/lib/db/schema";
import type { Database } from "../src/modules/catalog/service";
import { unitDefinitions } from "../src/lib/units/convert";
import { roleNames, type Role } from "../src/modules/auth/policy";

export const demoUsers = [
  ["salesman-a", "Salesman A", "salesman.a", "salesman"],
  ["salesman-b", "Salesman B", "salesman.b", "salesman"],
  ["admin", "Factory Admin", "admin", "admin"],
  ["production", "Production Supervisor", "production", "production"],
  ["auditor", "Auditor", "auditor", "auditor"],
  ["owner", "Owner", "owner", "owner"],
] as const;
export async function seedDemo(db: Database, password: string) {
  if (password.length < 12)
    throw new Error("DEMO_PASSWORD must have at least 12 characters.");
  const hashed = await hashPassword(password);
  await db.transaction(async (tx) => {
    const deleted = new Set(
      (
        await tx.execute(
          sql`SELECT resource,record_id FROM nova.deleted_records WHERE resource IN ('users','prices')`,
        )
      ).rows.map((r) => `${r.resource}:${r.record_id}`),
    );
    await tx
      .insert(s.roles)
      .values(Object.entries(roleNames).map(([code, name]) => ({ code, name })))
      .onConflictDoNothing();
    await tx
      .insert(s.units)
      .values(
        Object.entries(unitDefinitions).map(
          ([code, [dimension, baseFactor]]) => ({
            code,
            dimension,
            baseFactor,
          }),
        ),
      )
      .onConflictDoNothing();
    for (const [key, name, email, role] of demoUsers) {
      const id = "demo-" + key;
      if (deleted.has("users:" + id)) continue;
      const [existing] = await tx
        .select()
        .from(s.user)
        .where(eq(s.user.id, id));
      if (!existing) {
        await tx.insert(s.user).values({
          id,
          name,
          email: email + "@example.test",
          emailVerified: false,
        });
        await tx.insert(s.account).values({
          id: id + "-credential",
          userId: id,
          accountId: id,
          providerId: "credential",
          password: hashed,
        });
        await tx.insert(s.userRoles).values({ userId: id, role: role as Role });
      }
    }
    await tx
      .insert(s.territories)
      .values([
        {
          id: "demo-territory-a",
          name: "Demo Tamil Nadu",
          salesmanId: "demo-salesman-a",
        },
        {
          id: "demo-territory-b",
          name: "Demo Karnataka",
          salesmanId: "demo-salesman-b",
        },
      ])
      .onConflictDoNothing();
    await tx
      .insert(s.customers)
      .values([
        {
          id: "demo-retailer-a",
          name: "Retailer A",
          state: "Tamil Nadu",
          address: "Demo retailer address, Tamil Nadu",
          territoryId: "demo-territory-a",
        },
        {
          id: "demo-distributor-b",
          name: "Distributor B",
          state: "Karnataka",
          address: "Demo distributor address, Karnataka",
          territoryId: "demo-territory-b",
        },
      ])
      .onConflictDoNothing();
    await tx
      .insert(s.inventoryItems)
      .values([
        { id: "demo-flour", name: "Flour", kind: "raw", baseUnit: "g" },
        { id: "demo-oil", name: "Cooking oil", kind: "raw", baseUnit: "ml" },
        {
          id: "demo-spice",
          name: "Salt and spice mix",
          kind: "raw",
          baseUnit: "g",
        },
        {
          id: "demo-pouch",
          name: "200 g pouches",
          kind: "packaging",
          baseUnit: "piece",
        },
        {
          id: "demo-carton",
          name: "Cartons",
          kind: "packaging",
          baseUnit: "piece",
        },
        {
          id: "demo-finished",
          name: "Murukku 200 g",
          kind: "finished",
          baseUnit: "packet",
        },
      ])
      .onConflictDoNothing();
    await tx
      .insert(s.products)
      .values({
        id: "demo-murukku",
        name: "Murukku 200 g",
        itemId: "demo-finished",
        packGrams: "200",
        cartonCapacity: 20,
      })
      .onConflictDoNothing();
    if (!deleted.has("prices:demo-price"))
      await tx
        .insert(s.productPrices)
        .values({
          id: "demo-price",
          productId: "demo-murukku",
          amount: "50.00",
          gstPercent: "5.00",
        })
        .onConflictDoNothing();
    const [existingBom] = await tx
      .select()
      .from(s.bomVersions)
      .where(eq(s.bomVersions.id, "demo-bom-1"));
    if (!existingBom) {
      await tx.insert(s.bomVersions).values({
        id: "demo-bom-1",
        productId: "demo-murukku",
        revision: 1,
        batchSize: "1",
        expectedOutput: "200",
        outputUnit: "packet",
        createdBy: "demo-admin",
      });
      await tx.insert(s.bomLines).values(
        [
          ["flour", "40", "kg"],
          ["oil", "10", "L"],
          ["spice", "1.2", "kg"],
          ["pouch", "200", "piece"],
          ["carton", "10", "piece"],
        ].map(([key, quantity, unit]) => ({
          id: "demo-bom-line-" + key,
          bomId: "demo-bom-1",
          itemId: "demo-" + key,
          quantity,
          unit,
        })),
      );
      await tx
        .update(s.bomVersions)
        .set({ active: true, publishedAt: new Date() })
        .where(eq(s.bomVersions.id, "demo-bom-1"));
      await tx.insert(s.auditEvents).values({
        id: "demo-seed-audit",
        actorId: "demo-admin",
        action: "demo.seed",
        documentId: "demo-bom-1",
        after: { fixture: "NIT benchmark masters" },
      });
    }
  });
}
