import { eq, and, desc } from "drizzle-orm";
import * as s from "../../lib/db/schema";
import { authorize, AccessError, type Actor } from "../auth/policy";
import { bomInput } from "./validation";
import type { Database } from "./service";
import { convert, type Unit } from "../../lib/units/convert";

export async function getBom(db: Database, actor: Actor | null, id: string) {
  authorize(actor, "boms");
  const [bom] = await db
    .select()
    .from(s.bomVersions)
    .where(eq(s.bomVersions.id, id));
  if (!bom) throw new AccessError(404, "BOM not found.");
  const lines = await db
    .select({
      itemId: s.bomLines.itemId,
      item: s.inventoryItems.name,
      quantity: s.bomLines.quantity,
      unit: s.bomLines.unit,
    })
    .from(s.bomLines)
    .innerJoin(s.inventoryItems, eq(s.inventoryItems.id, s.bomLines.itemId))
    .where(eq(s.bomLines.bomId, id));
  return { ...bom, lines };
}
export async function publishBom(
  db: Database,
  actor: Actor | null,
  input: unknown,
) {
  authorize(actor, "boms", true);
  const value = bomInput.parse(input);
  return db.transaction(async (tx) => {
    const [product] = await tx
      .select()
      .from(s.products)
      .where(eq(s.products.id, value.productId))
      .for("update");
    if (!product) throw new AccessError(422, "Product does not exist.");
    for (const line of value.lines) {
      const [item] = await tx
        .select()
        .from(s.inventoryItems)
        .where(eq(s.inventoryItems.id, line.itemId));
      if (!item || item.kind === "finished")
        throw new AccessError(
          422,
          "BOM components must be raw or packaging materials.",
        );
      try {
        convert(line.quantity, line.unit, item.baseUnit as Unit);
      } catch {
        throw new AccessError(
          422,
          "The component unit is incompatible with its material.",
        );
      }
    }
    const [previous] = await tx
      .select()
      .from(s.bomVersions)
      .where(eq(s.bomVersions.productId, value.productId))
      .orderBy(desc(s.bomVersions.revision))
      .limit(1);
    const [bom] = await tx
      .insert(s.bomVersions)
      .values({
        productId: value.productId,
        revision: (previous?.revision ?? 0) + 1,
        batchSize: value.batchSize,
        expectedOutput: value.expectedOutput,
        outputUnit: value.outputUnit,
        createdBy: actor.id,
      })
      .returning();
    await tx
      .insert(s.bomLines)
      .values(value.lines.map((line) => ({ ...line, bomId: bom.id })));
    await tx
      .update(s.bomVersions)
      .set({ active: false })
      .where(
        and(
          eq(s.bomVersions.productId, product.id),
          eq(s.bomVersions.active, true),
        ),
      );
    await tx
      .update(s.bomVersions)
      .set({ active: true, publishedAt: new Date() })
      .where(eq(s.bomVersions.id, bom.id));
    await tx.insert(s.auditEvents).values({
      actorId: actor.id,
      action: "bom.publish",
      documentId: bom.id,
      after: { ...value, revision: bom.revision },
    });
    return bom;
  });
}
