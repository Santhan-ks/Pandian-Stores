import { pgSchema, text, timestamp } from "drizzle-orm/pg-core";

export const nova = pgSchema("nova");

export const systemSettings = nova.table("system_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
