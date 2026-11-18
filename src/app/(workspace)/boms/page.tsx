import Link from "next/link";
import { pageActor } from "@/modules/auth/server";
import { canRead, canWrite, canDelete } from "@/modules/auth/policy";
import { DeleteRecord } from "@/components/delete-record";
import { getDatabase } from "@/lib/db/connection";
import { listBoms, listMaster } from "@/modules/catalog/service";
import { BomForm } from "@/components/bom-form";
export default async function BomsPage() {
  const actor = await pageActor();
  if (!canRead(actor.role, "boms"))
    return <p>You do not have access to BOMs.</p>;
  const db = getDatabase();
  const rows = await listBoms(db, actor);
  return (
    <>
      <h1>Bills of Materials</h1>
      {rows.length === 0 && <p>No BOMs published yet.</p>}
      <ul>
        {rows.map((b) => (
          <li key={b.id}>
            <Link href={"/boms/" + b.id}>
              {b.product} — Revision {b.revision}
            </Link>{" "}
            · {b.active ? "Active" : "Previous"} · {b.expectedOutput} packets
            {canDelete(actor.role) && (
              <DeleteRecord
                resource="boms"
                id={b.id}
                label={`${b.product} revision ${b.revision}`}
                protectedReason="Published recipes are immutable history."
              />
            )}
          </li>
        ))}
      </ul>
      {canWrite(actor.role, "boms") && (
        <BomForm
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
        />
      )}
    </>
  );
}

export const metadata = { title: "Bills of Materials" };
