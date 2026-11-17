import { z } from "zod";
import { Decimal } from "decimal.js";
const name = z.string().trim().min(1).max(160);
const id = z.string().min(1).max(100);
export const quantity = z
  .string()
  .regex(
    /^\d{1,14}(\.\d{1,6})?$/,
    "Use a positive decimal with at most six decimal places.",
  )
  .refine((v) => new Decimal(v).gt(0), "Must be greater than zero.");
const money = z
  .string()
  .regex(/^\d{1,14}(\.\d{1,2})?$/, "Use at most two decimal places.")
  .refine((v) => new Decimal(v).gt(0));
export const schemas = {
  users: z
    .object({
      name,
      email: z.email().toLowerCase(),
      role: z.enum(["salesman", "admin", "production", "auditor", "owner"]),
      password: z
        .string()
        .max(128)
        .refine(
          (v) => v.length === 0 || v.length >= 12,
          "Use at least 12 characters.",
        ),
    })
    .strict(),
  customers: z
    .object({
      name,
      state: name,
      address: z.string().trim().min(1).max(500),
      territoryId: id,
    })
    .strict(),
  suppliers: z
    .object({ name, state: name, address: z.string().trim().min(1).max(500) })
    .strict(),
  territories: z.object({ name, salesmanId: id }).strict(),
  materials: z
    .object({
      name,
      kind: z.enum(["raw", "packaging"]),
      baseUnit: z.enum(["g", "ml", "piece"]),
    })
    .strict(),
  products: z
    .object({
      name,
      packGrams: quantity,
      cartonCapacity: z.coerce.number().int().min(1).max(10000),
    })
    .strict(),
  prices: z
    .object({
      productId: id,
      amount: money,
      gstPercent: z
        .string()
        .regex(/^\d{1,3}(\.\d{1,2})?$/)
        .refine((v) => new Decimal(v).gte(0) && new Decimal(v).lte(100)),
    })
    .strict(),
};
export const bomInput = z
  .object({
    productId: id,
    batchSize: quantity,
    expectedOutput: quantity,
    outputUnit: z.literal("packet"),
    lines: z
      .array(
        z
          .object({
            itemId: id,
            quantity,
            unit: z.enum(["g", "kg", "ml", "L", "piece"]),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (v) => new Set(v.lines.map((l) => l.itemId)).size === v.lines.length,
    "A component may appear only once.",
  );
export type Resource = keyof typeof schemas;
