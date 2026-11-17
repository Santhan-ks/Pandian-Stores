import {
  pgSchema,
  text,
  timestamp,
  boolean,
  numeric,
  integer,
  uniqueIndex,
  index,
  check,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const nova = pgSchema("nova");

export const systemSettings = nova.table("system_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const user = nova.table("users", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const session = nova.table(
  "sessions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);
export const account = nova.table(
  "accounts",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    password: text("password"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    scope: text("scope"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("account_provider_unique").on(t.providerId, t.accountId),
    index("accounts_user_idx").on(t.userId),
  ],
);
export const verification = nova.table(
  "verifications",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);
export const roles = nova.table(
  "roles",
  { code: text("code").primaryKey(), name: text("name").notNull() },
  (t) => [
    check(
      "role_code",
      sql`${t.code} in ('salesman','admin','production','auditor','owner')`,
    ),
  ],
);
export const userRoles = nova.table("user_roles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id),
  role: text("role")
    .notNull()
    .references(() => roles.code),
});
export const territories = nova.table(
  "territories",
  {
    id: id(),
    name: text("name").notNull().unique(),
    salesmanId: text("salesman_id")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index("territory_salesman_idx").on(t.salesmanId)],
);
export const customers = nova.table(
  "customers",
  {
    id: id(),
    name: text("name").notNull().unique(),
    state: text("state").notNull(),
    address: text("address").notNull(),
    territoryId: text("territory_id")
      .notNull()
      .references(() => territories.id),
    createdAt: createdAt(),
  },
  (t) => [index("customer_territory_idx").on(t.territoryId)],
);
export const suppliers = nova.table("suppliers", {
  id: id(),
  name: text("name").notNull().unique(),
  state: text("state").notNull(),
  address: text("address").notNull(),
  createdAt: createdAt(),
});
export const units = nova.table(
  "units",
  {
    code: text("code").primaryKey(),
    dimension: text("dimension").notNull(),
    baseFactor: numeric("base_factor", { precision: 20, scale: 6 }).notNull(),
  },
  (t) => [
    check("unit_positive", sql`${t.baseFactor} > 0`),
    check(
      "unit_dimension",
      sql`${t.dimension} in ('mass','volume','piece','packet','carton')`,
    ),
  ],
);
export const inventoryItems = nova.table(
  "inventory_items",
  {
    id: id(),
    name: text("name").notNull().unique(),
    kind: text("kind").notNull(),
    baseUnit: text("base_unit")
      .notNull()
      .references(() => units.code),
    createdAt: createdAt(),
  },
  (t) => [
    check("item_kind", sql`${t.kind} in ('raw','packaging','finished')`),
    check("item_base_unit", sql`${t.baseUnit} in ('g','ml','piece','packet')`),
  ],
);
export const products = nova.table(
  "products",
  {
    id: id(),
    name: text("name").notNull().unique(),
    itemId: text("item_id")
      .notNull()
      .unique()
      .references(() => inventoryItems.id),
    packGrams: numeric("pack_grams", { precision: 20, scale: 6 }).notNull(),
    cartonCapacity: integer("carton_capacity").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "product_pack_positive",
      sql`${t.packGrams} > 0 and ${t.cartonCapacity} > 0`,
    ),
  ],
);
export const productPrices = nova.table(
  "product_prices",
  {
    id: id(),
    productId: text("product_id")
      .notNull()
      .unique()
      .references(() => products.id),
    amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
    gstPercent: numeric("gst_percent", { precision: 5, scale: 2 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "price_valid",
      sql`${t.amount} > 0 and ${t.gstPercent} >= 0 and ${t.gstPercent} <= 100`,
    ),
  ],
);
export const bomVersions = nova.table(
  "bom_versions",
  {
    id: id(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    revision: integer("revision").notNull(),
    batchSize: numeric("batch_size", { precision: 20, scale: 6 }).notNull(),
    expectedOutput: numeric("expected_output", {
      precision: 20,
      scale: 6,
    }).notNull(),
    outputUnit: text("output_unit")
      .notNull()
      .references(() => units.code),
    active: boolean("active").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("bom_revision_unique").on(t.productId, t.revision),
    uniqueIndex("bom_active_unique")
      .on(t.productId)
      .where(sql`${t.active} = true`),
    check(
      "bom_positive",
      sql`${t.revision} > 0 and ${t.batchSize} > 0 and ${t.expectedOutput} > 0`,
    ),
    check("bom_output_packet", sql`${t.outputUnit} = 'packet'`),
  ],
);
export const bomLines = nova.table(
  "bom_lines",
  {
    id: id(),
    bomId: text("bom_id")
      .notNull()
      .references(() => bomVersions.id),
    itemId: text("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    quantity: numeric("quantity", { precision: 20, scale: 6 }).notNull(),
    unit: text("unit")
      .notNull()
      .references(() => units.code),
  },
  (t) => [
    uniqueIndex("bom_component_unique").on(t.bomId, t.itemId),
    check("bom_quantity_positive", sql`${t.quantity} > 0`),
  ],
);
export const auditEvents = nova.table(
  "audit_events",
  {
    id: id(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    action: text("action").notNull(),
    documentId: text("document_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_document_idx").on(t.documentId)],
);
