import {
  productionMode,
  validateProductionConfig,
  setting,
} from "../src/lib/config.js";
import { createDatabasePool } from "../src/lib/db/pool.js";
import { assertProductionDatabase } from "../src/lib/db/production.js";

// Validate before importing Next: its instrumentation failure leaves a listener
// running. This launcher must exit unsuccessfully without starting that listener.
try {
  if (!productionMode()) throw new Error("Production mode is required.");
  validateProductionConfig();
  const pool = createDatabasePool(setting("DATABASE_URL")!);
  try {
    await assertProductionDatabase(pool);
  } finally {
    await pool.end();
  }
  await import(new URL("../../server.js", import.meta.url).href);
} catch (error) {
  const cause = error instanceof Error ? (error.cause ?? error) : error;
  console.error(
    "Production startup refused; check configuration and database privileges.",
    { code: (cause as { code?: string })?.code ?? "configuration" },
  );
  process.exitCode = 1;
}
