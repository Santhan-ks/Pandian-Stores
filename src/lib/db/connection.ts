import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

let database: ReturnType<typeof drizzle> | undefined;

export function getDatabase() {
  if (!database) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    database = drizzle(new Pool({ connectionString: databaseUrl }));
  }

  return database;
}
