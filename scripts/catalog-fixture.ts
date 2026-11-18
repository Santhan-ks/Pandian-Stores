import { sql } from "drizzle-orm";
import type { Database } from "../src/modules/catalog/service";

// Only Murukku 200 g has a specified recipe and price. Other packs are illustrative setup.
export const extraCatalog = [
  { id: "demo-mixture", name: "Mixture 200 g", grams: "200" },
  { id: "demo-chips", name: "Chips 200 g", grams: "200" },
  { id: "demo-sweets", name: "Sweets 200 g", grams: "200" },
  { id: "demo-murukku-500", name: "Murukku 500 g", grams: "500" },
] as const;

export async function seedDemoCatalog(db: Database) {
  await db.transaction(async (tx) => {
    for (const product of extraCatalog) {
      if (
        (
          await tx.execute(
            sql`SELECT 1 FROM nova.deleted_records WHERE resource='products' AND record_id=${product.id}`,
          )
        ).rows.length
      )
        continue;
      const itemId = product.id + "-finished";
      await tx.execute(
        sql`INSERT INTO nova.inventory_items(id,name,kind,base_unit) VALUES(${itemId},${product.name},'finished','packet') ON CONFLICT(id) DO NOTHING`,
      );
      const inserted = await tx.execute(
        sql`INSERT INTO nova.products(id,name,item_id,pack_grams,carton_capacity) VALUES(${product.id},${product.name},${itemId},${product.grams}::numeric,20) ON CONFLICT(id) DO NOTHING RETURNING id`,
      );
      if (inserted.rows.length)
        await tx.execute(
          sql`INSERT INTO nova.audit_events(id,actor_id,action,document_id,after) VALUES(${product.id + "-catalog-seed"},'demo-admin','catalog.seed',${product.id},${JSON.stringify({ ...product, cartonCapacity: 20, assumption: "Illustrative pack only; no recipe, price or tax rate supplied." })}::jsonb)`,
        );
    }
  });
}
