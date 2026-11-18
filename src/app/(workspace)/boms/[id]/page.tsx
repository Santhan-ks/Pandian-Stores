import Link from "next/link";
import { getDatabase } from "@/lib/db/connection";
import { pageActor } from "@/modules/auth/server";
import { canRead, canWrite } from "@/modules/auth/policy";
import { getBom } from "@/modules/catalog/bom";
import { listMaster } from "@/modules/catalog/service";
import { BomForm } from "@/components/bom-form";
export default async function BomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await pageActor();
  if (!canRead(actor.role, "boms"))
    return <p>You do not have access to BOMs.</p>;
  const db = getDatabase();
  const bom = await getBom(db, actor, (await params).id);
  return (
    <>
      <Link href="/boms">All BOMs</Link>
      <h1>BOM revision {bom.revision}</h1>
      <p>
        {bom.active ? "Active" : "Previous"} · {bom.batchSize} batch(es) ·{" "}
        {bom.expectedOutput} expected packets
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Component</th>
              <th>Quantity</th>
              <th>Unit</th>
            </tr>
          </thead>
          <tbody>
            {bom.lines.map((line) => (
              <tr key={line.itemId}>
                <td>{line.item}</td>
                <td>{line.quantity}</td>
                <td>{line.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canWrite(actor.role, "boms") && (
        <BomForm
          key={bom.id}
          products={
            (await listMaster(db, actor, "products")) as {
              id: string;
              name: string;
            }[]
          }
          materials={
            (await listMaster(db, actor, "materials")) as {
              id: string;
              name: string;
            }[]
          }
          initial={{
            productId: bom.productId,
            batchSize: bom.batchSize,
            expectedOutput: bom.expectedOutput,
            lines: bom.lines,
          }}
        />
      )}
    </>
  );
}

export const metadata = { title: "BOM revision" };
