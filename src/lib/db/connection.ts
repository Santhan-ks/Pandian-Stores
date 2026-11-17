import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

let database: NodePgDatabase<typeof schema> | undefined;

export function getDatabase() {
  if (!database) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    database = drizzle(new Pool({ connectionString: databaseUrl }), { schema });
  }

  return database;
}
