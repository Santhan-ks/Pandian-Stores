import { sql } from "drizzle-orm";
import type { Database } from "../src/modules/catalog/service";
import { createDocument, postDocument } from "../src/modules/inventory/service";
export async function inventoryFixture(db: Database) {
  const actor = { id: "demo-admin", role: "admin" } as const;
  const opening = await createDocument(db, actor, {
    category: "opening",
    supplierId: null,
    reason: "Benchmark opening inventory",
    requestKey: "demo-opening-stage2",
    lines: [
      ["demo-flour", "100", "kg", "42"],
      ["demo-oil", "30", "L", "140"],
      ["demo-spice", "5", "kg", "200"],
      ["demo-pouch", "500", "piece", "2.50"],
      ["demo-carton", "30", "piece", "15"],
      ["demo-finished", "50", "packet", null],
    ].map(([itemId, quantity, unit, unitRate]) => ({
      itemId,
      quantity,
      unit,
      unitRate,
    })),
  });
  await postDocument(db, actor, opening);
  await db.execute(
    sql`INSERT INTO nova.suppliers(id,name,state,address) VALUES('demo-flour-supplier','Demo flour supplier (invented)','Tamil Nadu','Invented benchmark supplier address') ON CONFLICT(id) DO NOTHING`,
  );
  const purchase = await createDocument(db, actor, {
    category: "purchase",
    supplierId: "demo-flour-supplier",
    reason: "Benchmark flour purchase",
    requestKey: "demo-purchase-stage2",
    lines: [
      { itemId: "demo-flour", quantity: "60", unit: "kg", unitRate: "45" },
    ],
  });
  await postDocument(db, actor, purchase);
}
