import { Pool } from "pg";
export function createDatabasePool(connectionString: string) {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("DATABASE_URL must be a PostgreSQL URL.");
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    max: 10,
  });
  pool.on("error", (error: Error & { code?: string }) =>
    console.error("Database pool connection closed", {
      code: error.code ?? "unknown",
    }),
  );
  return pool;
}
