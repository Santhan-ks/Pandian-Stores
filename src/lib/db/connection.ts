import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { createDatabasePool } from "./pool";
import * as schema from "./schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { setting } from "../config";

let database: NodePgDatabase<typeof schema> | undefined;

export function getDatabase() {
  if (!database) {
    const databaseUrl = setting("DATABASE_URL");
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    database = drizzle(createDatabasePool(databaseUrl), { schema });
  }

  return database;
}
