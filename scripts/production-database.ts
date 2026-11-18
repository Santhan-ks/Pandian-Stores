import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabasePool } from "../src/lib/db/pool";
import { setting, safeUrl } from "../src/lib/config";
import { bootstrapAccount } from "./lib/operator-account";
import { initializeReferenceData } from "./lib/reference-data";

const admin = createDatabasePool(setting("DB_ADMIN_URL") ?? "");
const ownerUrl = safeUrl(setting("DATABASE_URL"), "DATABASE_URL");
const runtimeUrl = safeUrl(
  setting("RUNTIME_DATABASE_URL"),
  "RUNTIME_DATABASE_URL",
);
const owner = createDatabasePool(ownerUrl.toString());
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
try {
  if (
    ownerUrl.username !== "pandian_owner" ||
    runtimeUrl.username !== "pandian_app" ||
    ownerUrl.pathname !== "/pandian" ||
    runtimeUrl.pathname !== "/pandian" ||
    ownerUrl.host !== runtimeUrl.host
  )
    throw new Error("Unexpected deployment database configuration.");
  for (const url of [ownerUrl, runtimeUrl]) {
    if (!/^[a-f0-9]{64}$/.test(url.password))
      throw new Error(
        "Deployment database passwords must be generated 32-byte hex values.",
      );
    const exists = await admin.query(
      "SELECT 1 FROM pg_roles WHERE rolname=$1",
      [url.username],
    );
    const verb = exists.rowCount ? "ALTER" : "CREATE";
    await admin.query(
      `${verb} ROLE ${url.username} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD ${literal(url.password)}`,
    );
  }
  await admin.query(
    "REVOKE ALL ON DATABASE pandian FROM PUBLIC; GRANT CONNECT, CREATE ON DATABASE pandian TO pandian_owner; GRANT CONNECT ON DATABASE pandian TO pandian_app; REVOKE ALL ON SCHEMA public FROM PUBLIC",
  );
  await admin.query(
    "ALTER ROLE pandian_app SET statement_timeout='30s'; ALTER ROLE pandian_app SET lock_timeout='5s'; ALTER ROLE pandian_app SET idle_in_transaction_session_timeout='30s'",
  );
  const lock = await owner.connect();
  try {
    await lock.query(
      "SELECT pg_advisory_lock(hashtextextended('pandian-migrations',0))",
    );
    await migrate(drizzle(owner), { migrationsFolder: "drizzle" });
    await owner.query(readFileSync("docker/runtime-grants.sql", "utf8"));
    await initializeReferenceData(owner);
    if (process.argv.includes("--bootstrap"))
      await bootstrapAccount(owner, process.env.OPERATOR_ACCOUNT_FILE ?? "");
    console.log(
      "Production migrations and reviewed runtime grants applied; no demo data seeded.",
    );
  } finally {
    await lock.query(
      "SELECT pg_advisory_unlock(hashtextextended('pandian-migrations',0))",
    );
    lock.release();
  }
} catch (error) {
  console.error("Production database setup failed.", {
    code: (error as { code?: string }).code ?? "configuration",
  });
  process.exitCode = 1;
} finally {
  await Promise.all([admin.end(), owner.end()]);
}
