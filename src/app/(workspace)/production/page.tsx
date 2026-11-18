import { getDatabase } from "@/lib/db/connection";
import { pageActor } from "@/modules/auth/server";
import { listRuns, overheadHistory } from "@/modules/production/service";
import { listBoms, listMaster } from "@/modules/catalog/service";
import { getBom } from "@/modules/catalog/bom";
import {
  Production,
  type BomChoice,
  type Run,
  type Overhead,
} from "@/components/production";
export default async function Page() {
  const actor = await pageActor();
  if (actor.role === "salesman")
    return <p>You do not have production access.</p>;
  const db = getDatabase();
  const choices = await listBoms(db, actor);
  const boms = await Promise.all(
    choices.map(async (b) => ({ ...b, ...(await getBom(db, actor, b.id)) })),
  );
  return (
    <Production
      writable={["admin", "production"].includes(actor.role)}
      deletable={["admin", "owner"].includes(actor.role)}
      prices={
        JSON.parse(JSON.stringify(await listMaster(db, actor, "prices"))) as {
          productId: string;
          amount: string;
        }[]
      }
      runs={JSON.parse(JSON.stringify(await listRuns(db, actor))) as Run[]}
      boms={JSON.parse(JSON.stringify(boms)) as BomChoice[]}
      history={
        JSON.parse(
          JSON.stringify(await overheadHistory(db, actor)),
        ) as Overhead[]
      }
    />
  );
}

export const metadata = { title: "Production" };
