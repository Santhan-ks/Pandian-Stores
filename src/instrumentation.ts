export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NOVA_DEPLOYMENT_MODE === "production"
  ) {
    const { validateProductionConfig, setting } = await import("./lib/config");
    const { createDatabasePool } = await import("./lib/db/pool");
    const { assertProductionDatabase } = await import("./lib/db/production");
    validateProductionConfig();
    const pool = createDatabasePool(setting("DATABASE_URL")!);
    try {
      await assertProductionDatabase(pool);
    } finally {
      await pool.end();
    }
  }
}
