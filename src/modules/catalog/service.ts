import { and, eq, desc, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as s from "../../lib/db/schema";
import { authorize, type Actor, AccessError } from "../auth/policy";
import { schemas, type Resource } from "./validation";
import { Decimal } from "decimal.js";
import { hashPassword } from "better-auth/crypto";

export type Database = NodePgDatabase<typeof s>;
export async function listMaster(
  db: Database,
  actor: Actor | null,
  resource: Resource,
) {
  authorize(actor, resource);
  switch (resource) {
    case "users":
      return db
        .select({
          id: s.user.id,
          name: s.user.name,
          email: s.user.email,
          role: s.userRoles.role,
        })
        .from(s.user)
        .innerJoin(s.userRoles, eq(s.user.id, s.userRoles.userId))
        .orderBy(s.user.name);
    case "customers":
      return db
        .select({
          id: s.customers.id,
          name: s.customers.name,
          state: s.customers.state,
          address: s.customers.address,
          territoryId: s.customers.territoryId,
        })
        .from(s.customers)
        .innerJoin(s.territories, eq(s.customers.territoryId, s.territories.id))
        .where(
          actor.role === "salesman"
            ? eq(s.territories.salesmanId, actor.id)
            : undefined,
        )
        .orderBy(s.customers.name);
    case "territories":
      return db.select().from(s.territories).orderBy(s.territories.name);
    case "suppliers":
      return db.select().from(s.suppliers).orderBy(s.suppliers.name);
    case "materials":
      return db
        .select()
        .from(s.inventoryItems)
        .where(sql`${s.inventoryItems.kind} <> 'finished'`)
        .orderBy(s.inventoryItems.name);
    case "products":
      return db.select().from(s.products).orderBy(s.products.name);
    case "prices":
      return db
        .select({
          id: s.productPrices.id,
          productId: s.productPrices.productId,
          product: s.products.name,
          amount: s.productPrices.amount,
          gstPercent: s.productPrices.gstPercent,
        })
        .from(s.productPrices)
        .innerJoin(s.products, eq(s.products.id, s.productPrices.productId))
        .orderBy(s.products.name);
  }
}
export async function saveMaster(
  db: Database,
  actor: Actor | null,
  resource: Resource,
  input: unknown,
  existingId?: string,
) {
  authorize(actor, resource, true);
  return db.transaction(async (tx) => {
    let before: unknown = null;
    let saved: { id: string } | undefined;
    if (resource === "users") {
      const value = schemas.users.parse(input);
      if (!existingId && value.password.length < 12)
        throw new AccessError(
          422,
          "A password of at least 12 characters is required.",
        );
      if (existingId === actor.id && value.role !== "admin")
        throw new AccessError(422, "You cannot remove your own admin role.");
      if (existingId) {
        [before] = await tx
          .select({
            name: s.user.name,
            email: s.user.email,
            role: s.userRoles.role,
          })
          .from(s.user)
          .innerJoin(s.userRoles, eq(s.user.id, s.userRoles.userId))
          .where(eq(s.user.id, existingId));
        [saved] = await tx
          .update(s.user)
          .set({ name: value.name, email: value.email, updatedAt: new Date() })
          .where(eq(s.user.id, existingId))
          .returning();
        if (saved) {
          await tx
            .update(s.userRoles)
            .set({ role: value.role })
            .where(eq(s.userRoles.userId, saved.id));
          if (value.password)
            await tx
              .update(s.account)
              .set({
                password: await hashPassword(value.password),
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(s.account.userId, saved.id),
                  eq(s.account.providerId, "credential"),
                ),
              );
          await tx.delete(s.session).where(eq(s.session.userId, saved.id));
        }
      } else {
        [saved] = await tx
          .insert(s.user)
          .values({ name: value.name, email: value.email })
          .returning();
        await tx
          .insert(s.userRoles)
          .values({ userId: saved.id, role: value.role });
        await tx.insert(s.account).values({
          userId: saved.id,
          accountId: saved.id,
          providerId: "credential",
          password: await hashPassword(value.password),
        });
      }
    } else if (resource === "customers") {
      const value = schemas.customers.parse(input);
      if (existingId) {
        [before] = await tx
          .select()
          .from(s.customers)
          .where(eq(s.customers.id, existingId))
          .for("update");
        [saved] = await tx
          .update(s.customers)
          .set(value)
          .where(eq(s.customers.id, existingId))
          .returning();
      } else [saved] = await tx.insert(s.customers).values(value).returning();
    } else if (resource === "suppliers") {
      const value = schemas.suppliers.parse(input);
      if (existingId) {
        [before] = await tx
          .select()
          .from(s.suppliers)
          .where(eq(s.suppliers.id, existingId))
          .for("update");
        [saved] = await tx
          .update(s.suppliers)
          .set(value)
          .where(eq(s.suppliers.id, existingId))
          .returning();
      } else [saved] = await tx.insert(s.suppliers).values(value).returning();
    } else if (resource === "territories") {
      const value = schemas.territories.parse(input);
      const [salesman] = await tx
        .select()
        .from(s.userRoles)
        .where(
          and(
            eq(s.userRoles.userId, value.salesmanId),
            eq(s.userRoles.role, "salesman"),
          ),
        );
      if (!salesman)
        throw new AccessError(422, "Assign a salesman to the territory.");
      if (existingId) {
        [before] = await tx
          .select()
          .from(s.territories)
          .where(eq(s.territories.id, existingId))
          .for("update");
        [saved] = await tx
          .update(s.territories)
          .set(value)
          .where(eq(s.territories.id, existingId))
          .returning();
      } else [saved] = await tx.insert(s.territories).values(value).returning();
    } else if (resource === "materials") {
      const value = schemas.materials.parse(input);
      if (existingId) {
        const [old] = await tx
          .select()
          .from(s.inventoryItems)
          .where(eq(s.inventoryItems.id, existingId))
          .for("update");
        before = old;
        if (old && (old.kind !== value.kind || old.baseUnit !== value.baseUnit))
          throw new AccessError(
            422,
            "Material kind and base unit are immutable. Create a new material.",
          );
        [saved] = await tx
          .update(s.inventoryItems)
          .set({ name: value.name })
          .where(eq(s.inventoryItems.id, existingId))
          .returning();
      } else
        [saved] = await tx.insert(s.inventoryItems).values(value).returning();
    } else if (resource === "products") {
      const value = schemas.products.parse(input);
      if (existingId) {
        const [old] = await tx
          .select()
          .from(s.products)
          .where(eq(s.products.id, existingId))
          .for("update");
        before = old;
        if (
          old &&
          (!new Decimal(old.packGrams).eq(value.packGrams) ||
            old.cartonCapacity !== value.cartonCapacity)
        )
          throw new AccessError(
            422,
            "Create a new product for a different pack size or carton capacity.",
          );
        [saved] = await tx
          .update(s.products)
          .set({ name: value.name })
          .where(eq(s.products.id, existingId))
          .returning();
        if (old)
          await tx
            .update(s.inventoryItems)
            .set({ name: value.name })
            .where(eq(s.inventoryItems.id, old.itemId));
      } else {
        const [item] = await tx
          .insert(s.inventoryItems)
          .values({ name: value.name, kind: "finished", baseUnit: "packet" })
          .returning();
        [saved] = await tx
          .insert(s.products)
          .values({ ...value, itemId: item.id })
          .returning();
      }
    } else {
      const value = schemas.prices.parse(input);
      if (existingId) {
        const [old] = await tx
          .select()
          .from(s.productPrices)
          .where(eq(s.productPrices.id, existingId))
          .for("update");
        before = old;
        if (old && old.productId !== value.productId)
          throw new AccessError(422, "The price must retain its product.");
        [saved] = await tx
          .update(s.productPrices)
          .set({ ...value, updatedAt: new Date() })
          .where(eq(s.productPrices.id, existingId))
          .returning();
      } else
        [saved] = await tx.insert(s.productPrices).values(value).returning();
    }
    if (!saved) throw new AccessError(404, "Record not found.");
    await tx.insert(s.auditEvents).values({
      actorId: actor.id,
      action: resource + (existingId ? ".update" : ".create"),
      documentId: saved.id,
      before,
      after:
        resource === "users"
          ? { ...saved, role: schemas.users.parse(input).role }
          : saved,
    });
    return saved;
  });
}
export async function listBoms(db: Database, actor: Actor | null) {
  authorize(actor, "boms");
  return db
    .select({
      id: s.bomVersions.id,
      productId: s.bomVersions.productId,
      product: s.products.name,
      revision: s.bomVersions.revision,
      batchSize: s.bomVersions.batchSize,
      expectedOutput: s.bomVersions.expectedOutput,
      outputUnit: s.bomVersions.outputUnit,
      active: s.bomVersions.active,
    })
    .from(s.bomVersions)
    .innerJoin(s.products, eq(s.products.id, s.bomVersions.productId))
    .orderBy(desc(s.bomVersions.createdAt));
}
