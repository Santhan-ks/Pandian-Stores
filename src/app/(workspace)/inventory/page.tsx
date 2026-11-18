import { Inventory } from "@/components/inventory";
import { pageActor } from "@/modules/auth/server";
import { getDatabase } from "@/lib/db/connection";
import { inventoryItems, suppliers } from "@/lib/db/schema";
import { readInventory } from "@/modules/inventory/service";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const actor = await pageActor();
  if (actor.role === "salesman")
    return <p>You do not have inventory access.</p>;
  const db = getDatabase();
  const data = await readInventory(db, actor, await searchParams);
  return (
    <Inventory
      role={actor.role}
      data={JSON.parse(JSON.stringify(data))}
      items={await db
        .select({ id: inventoryItems.id, name: inventoryItems.name })
        .from(inventoryItems)}
      suppliers={await db
        .select({ id: suppliers.id, name: suppliers.name })
        .from(suppliers)}
    />
  );
}

export const metadata = { title: "Inventory" };
