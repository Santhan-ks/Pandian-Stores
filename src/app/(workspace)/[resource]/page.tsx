import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/db/connection";
import { pageActor } from "@/modules/auth/server";
import { canWrite, canRead } from "@/modules/auth/policy";
import { schemas, type Resource } from "@/modules/catalog/validation";
import { listMaster } from "@/modules/catalog/service";
import { territories, products, user, userRoles } from "@/lib/db/schema";
import { MasterEditor, type Field } from "@/components/master-form";
export default async function MasterPage({
  params,
}: {
  params: Promise<{ resource: string }>;
}) {
  const { resource } = await params;
  if (!Object.hasOwn(schemas, resource)) notFound();
  const key = resource as Resource;
  const actor = await pageActor();
  if (!canRead(actor.role, key))
    return <p>You do not have access to this page.</p>;
  const db = getDatabase();
  const writable = canWrite(actor.role, key);
  const fields: Record<Resource, Field[]> = {
    users: [
      { key: "name", label: "Name" },
      { key: "email", label: "Email", type: "email" },
      {
        key: "role",
        label: "Role",
        options: ["salesman", "admin", "production", "auditor", "owner"].map(
          (value) => ({ value, label: value }),
        ),
      },
      {
        key: "password",
        label: "Password (leave blank to keep when editing)",
        type: "password",
      },
    ],
    customers: [
      { key: "name", label: "Name" },
      { key: "state", label: "State" },
      { key: "address", label: "Address" },
      { key: "territoryId", label: "Territory" },
    ],
    suppliers: [
      { key: "name", label: "Name" },
      { key: "state", label: "State" },
      { key: "address", label: "Address" },
    ],
    territories: [
      { key: "name", label: "Name" },
      { key: "salesmanId", label: "Salesman" },
    ],
    materials: [
      { key: "name", label: "Name" },
      {
        key: "kind",
        label: "Kind",
        options: ["raw", "packaging"].map((value) => ({ value, label: value })),
      },
      {
        key: "baseUnit",
        label: "Base unit",
        options: ["g", "ml", "piece"].map((value) => ({ value, label: value })),
      },
    ],
    products: [
      { key: "name", label: "Product / pack name" },
      { key: "packGrams", label: "Pack size (grams)" },
      { key: "cartonCapacity", label: "Packets per carton" },
    ],
    prices: [
      { key: "productId", label: "Product" },
      { key: "amount", label: "Price before GST (INR)" },
      { key: "gstPercent", label: "GST rate (%)" },
    ],
  };
  if (key === "customers")
    fields.customers[3].options = (
      await db
        .select()
        .from(territories)
        .where(
          actor.role === "salesman"
            ? eq(territories.salesmanId, actor.id)
            : undefined,
        )
    ).map((t) => ({ value: t.id, label: t.name }));
  if (key === "territories")
    fields.territories[1].options = (
      await db
        .select({ id: user.id, name: user.name })
        .from(user)
        .innerJoin(userRoles, eq(user.id, userRoles.userId))
        .where(eq(userRoles.role, "salesman"))
    ).map((u) => ({ value: u.id, label: u.name }));
  if (key === "prices")
    fields.prices[0].options = (await db.select().from(products)).map((p) => ({
      value: p.id,
      label: p.name,
    }));
  const rows = await listMaster(db, actor, key);
  return (
    <>
      <h1>{key.charAt(0).toUpperCase() + key.slice(1)}</h1>
      {key === "products" && (
        <p>
          Create a separate product for each pack size. Pack size and carton
          capacity cannot be changed after creation.
        </p>
      )}
      <MasterEditor
        resource={key}
        rows={JSON.parse(JSON.stringify(rows))}
        fields={fields[key]}
        writable={writable}
      />
    </>
  );
}
