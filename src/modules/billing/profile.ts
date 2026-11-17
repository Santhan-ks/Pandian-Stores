import { z } from "zod";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Database } from "../catalog/service";
import { AccessError, type Actor } from "../auth/policy";
export { SAMPLE_NOTICE } from "./notice";
export const invoiceMode = z.enum(["demo", "real"]);
// Stage 4 supports these two configured supply states. Other states fail closed.
export const stateCodes: Record<string, string> = {
  "Tamil Nadu": "33",
  Karnataka: "29",
};
export function validGstin(value: string, stateCode: string) {
  if (
    !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value) ||
    !value.startsWith(stateCode)
  )
    return false;
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let sum = 0,
    factor = 2;
  for (let i = 13; i >= 0; i--) {
    const product = alphabet.indexOf(value[i]) * factor;
    sum += Math.floor(product / 36) + (product % 36);
    factor = factor === 2 ? 1 : 2;
  }
  return alphabet[(36 - (sum % 36)) % 36] === value[14];
}
export function demoInvoicesEnabled() {
  return process.env.NOVA_ALLOW_DEMO_INVOICES === "true";
}
export const profileSchema = z
  .object({
    mode: invoiceMode,
    name: z.string().trim().min(2).max(100),
    address: z.string().trim().min(5).max(200),
    state: z.enum(["Tamil Nadu", "Karnataka"]),
    gstin: z.string().trim().min(1).max(30),
    products: z
      .array(
        z
          .object({
            productId: z.string().min(1),
            hsn: z.string().regex(/^\d{4,8}$/),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export async function readProfiles(db: Database, actor: Actor | null) {
  if (!actor) throw new AccessError(401, "Please sign in.");
  if (actor.role !== "admin")
    throw new AccessError(403, "Only admins configure billing.");
  return (
    await db.execute(
      sql`SELECT b.*,(SELECT jsonb_agg(jsonb_build_object('productId',t.product_id,'hsn',t.hsn)) FROM nova.product_tax_settings t WHERE t.mode=b.mode) AS products FROM nova.business_profiles b ORDER BY mode`,
    )
  ).rows;
}
export async function saveProfile(
  db: Database,
  actor: Actor | null,
  input: unknown,
) {
  if (!actor) throw new AccessError(401, "Please sign in.");
  if (actor.role !== "admin")
    throw new AccessError(403, "Only admins configure billing.");
  const data = profileSchema.parse(input);
  const code = stateCodes[data.state];
  if (data.mode === "demo" && !demoInvoicesEnabled())
    throw new AccessError(403, "Demo invoice generation is disabled.");
  if (data.mode === "real" && !validGstin(data.gstin, code))
    throw new AccessError(
      422,
      "Seller GSTIN must have valid format, state code and checksum.",
    );
  if (data.mode === "demo" && validGstin(data.gstin, code))
    throw new AccessError(422, "Demo GSTIN must be deliberately invalid.");
  if (
    new Set(data.products.map((p) => p.productId)).size !== data.products.length
  )
    throw new AccessError(422, "Duplicate product tax setting.");
  await db.transaction(async (tx) => {
    const before = (
      await tx.execute(
        sql`SELECT * FROM nova.business_profiles WHERE mode=${data.mode} FOR UPDATE`,
      )
    ).rows[0];
    await tx.execute(
      sql`INSERT INTO nova.business_profiles(mode,name,address,state,state_code,gstin,updated_by) VALUES(${data.mode},${data.name},${data.address},${data.state},${code},${data.gstin},${actor.id}) ON CONFLICT(mode) DO UPDATE SET name=excluded.name,address=excluded.address,state=excluded.state,state_code=excluded.state_code,gstin=excluded.gstin,updated_by=excluded.updated_by,updated_at=now()`,
    );
    await tx.execute(
      sql`DELETE FROM nova.product_tax_settings WHERE mode=${data.mode}`,
    );
    for (const p of data.products)
      await tx.execute(
        sql`INSERT INTO nova.product_tax_settings(mode,product_id,hsn) VALUES(${data.mode},${p.productId},${p.hsn})`,
      );
    await tx.execute(
      sql`INSERT INTO nova.audit_events(id,actor_id,action,document_id,before,after) VALUES(${randomUUID()},${actor.id},'billing.profile',${data.mode},${JSON.stringify(before ?? null)}::jsonb,${JSON.stringify(data)}::jsonb)`,
    );
  });
}
export async function invoiceConfiguration(
  db: Database,
  mode: "demo" | "real",
) {
  if (mode === "demo" && !demoInvoicesEnabled())
    throw new AccessError(403, "Demo invoice generation is disabled.");
  const seller = (
    await db.execute(
      sql`SELECT name,address,state,state_code,gstin FROM nova.business_profiles WHERE mode=${mode} FOR SHARE`,
    )
  ).rows[0];
  if (!seller)
    throw new AccessError(422, "Configure the billing business profile first.");
  if (
    mode === "real" &&
    (!String(seller.name).trim() ||
      String(seller.address).trim().length < 5 ||
      stateCodes[String(seller.state)] !== seller.state_code ||
      !validGstin(String(seller.gstin), String(seller.state_code)))
  )
    throw new AccessError(
      422,
      "Real billing profile failed seller validation.",
    );
  if (
    mode === "demo" &&
    validGstin(String(seller.gstin), String(seller.state_code))
  )
    throw new AccessError(422, "Demo profile must use an invalid GSTIN.");
  return seller;
}
