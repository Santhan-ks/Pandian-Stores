import { readProfiles, demoInvoicesEnabled } from "@/modules/billing/profile";
import { currentActor } from "@/modules/auth/server";
import { salesAccess, listSales } from "@/modules/sales/service";
import { listMaster } from "@/modules/catalog/service";
import { getDatabase } from "@/lib/db/connection";
import { Sales } from "@/components/sales";
export default async function SalesPage() {
  const actor = salesAccess(await currentActor());
  const db = getDatabase();
  const [data, customers, prices] = await Promise.all([
    listSales(db, actor),
    listMaster(db, actor, "customers"),
    listMaster(db, actor, "prices"),
  ]);
  return (
    <Sales
      billing={
        actor.role === "admin"
          ? {
              profiles: JSON.parse(
                JSON.stringify(await readProfiles(db, actor)),
              ),
              demoEnabled: demoInvoicesEnabled(),
            }
          : null
      }
      role={actor.role}
      initial={JSON.parse(JSON.stringify(data))}
      customers={customers as { id: string; name: string }[]}
      prices={
        prices as { productId: string; product: string; amount: string }[]
      }
    />
  );
}

export const metadata = { title: "Sales" };
