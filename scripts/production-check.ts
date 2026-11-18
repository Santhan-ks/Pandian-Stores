import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { verifyPassword } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabasePool } from "../src/lib/db/pool";
import { setting, safeUrl } from "../src/lib/config";
import { assertProductionDatabase } from "../src/lib/db/production";
import { seedDemo } from "./seed-data";
import { inventoryFixture } from "./inventory-fixture";
import { productionFixture } from "./production-fixture";
import { salesFixture } from "./sales-fixture";
import { bootstrapAccount } from "./lib/operator-account";
import { initializeReferenceData } from "./lib/reference-data";
import * as schema from "../src/lib/db/schema";
import type { Pool } from "pg";

const admin = createDatabasePool(setting("DB_ADMIN_URL") ?? "");
const ownerUrl = safeUrl(setting("DATABASE_URL"), "DATABASE_URL");
const source =
  process.argv.find((arg) => arg.startsWith("--source="))?.split("=")[1] ??
  "pandian";
assert.match(source, /^(pandian|pandian_permissions_[a-f0-9]+_test)$/);
ownerUrl.pathname = "/" + source;
const appUrl = safeUrl(setting("RUNTIME_DATABASE_URL"), "RUNTIME_DATABASE_URL");
const app = createDatabasePool(appUrl.toString());
const owner = createDatabasePool(ownerUrl.toString());
let disposable: string | undefined,
  testOwner: Pool | undefined,
  testApp: Pool | undefined;

async function forbidden(pool: Pool, query: string, expected = "42501") {
  await assert.rejects(
    pool.query(query),
    (error: { code?: string }) => error.code === expected,
  );
}
async function fingerprint(pool: Pool) {
  const result: Record<string, unknown> = {};
  const tables = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname IN ('nova','drizzle') ORDER BY schemaname,tablename",
  );
  for (const { tablename } of tables.rows) {
    assert.match(tablename, /^[a-z_]+$/);
    const ns = tablename === "__drizzle_migrations" ? "drizzle" : "nova";
    const {
      rows: [row],
    } = await pool.query(
      `SELECT count(*)::text AS count, md5(coalesce(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text),'')) AS hash FROM ${ns}."${tablename}" t`,
    );
    result[`${ns}.${tablename}`] = row;
  }
  return result;
}
try {
  const restored = process.argv
    .find((arg) => arg.startsWith("--restored="))
    ?.split("=")[1];
  if (restored) {
    assert.match(restored, /^pandian_recovery_\d+$/);
    const restoreUrl = new URL(ownerUrl);
    restoreUrl.pathname = "/" + restored;
    const restore = createDatabasePool(restoreUrl.toString());
    try {
      assert.deepEqual(await fingerprint(restore), await fingerprint(owner));
    } finally {
      await restore.end();
    }
    console.log(
      "Recovery matches source: every nova table and migration history (counts and complete-row hashes). Run with writes paused; later source changes correctly cause a mismatch.",
    );
  } else {
    await assertProductionDatabase(app);
    for (const query of [
      "CREATE TABLE nova.forbidden_probe(id text)",
      "CREATE TEMP TABLE forbidden_probe(id text)",
      "TRUNCATE nova.audit_events CASCADE",
      "ALTER TABLE nova.inventory_movements DISABLE TRIGGER ALL",
      "SET ROLE pandian_owner",
      "UPDATE nova.audit_events SET action='tampered' WHERE false",
      "DELETE FROM nova.invoices WHERE false",
      "INSERT INTO nova.roles(code,name) VALUES('forbidden','forbidden')",
      "SELECT * FROM drizzle.__drizzle_migrations",
    ])
      await forbidden(app, query);
    await forbidden(
      app,
      "INSERT INTO nova.inventory_movements DEFAULT VALUES",
      "P0001",
    );
    assert.equal(
      (await app.query("SHOW statement_timeout")).rows[0].statement_timeout,
      "30s",
    );
    assert.equal(
      (await app.query("SHOW lock_timeout")).rows[0].lock_timeout,
      "5s",
    );
    await assert.rejects(
      bootstrapAccount(owner, process.env.OPERATOR_ACCOUNT_FILE!),
    );
    console.log(
      "Runtime restrictions passed: no DDL, temp tables, TRUNCATE, trigger bypass, owner escalation, history mutation, reference edits or migration access; direct ledger inserts blocked; repeated bootstrap rejected.",
    );

    disposable =
      "pandian_permissions_" + randomUUID().replaceAll("-", "") + "_test";
    await admin.query(
      `CREATE DATABASE "${disposable}" OWNER pandian_owner TEMPLATE template0`,
    );
    await admin.query(
      `REVOKE ALL ON DATABASE "${disposable}" FROM PUBLIC; GRANT CONNECT ON DATABASE "${disposable}" TO pandian_app`,
    );
    const testOwnerUrl = new URL(ownerUrl);
    testOwnerUrl.pathname = "/" + disposable;
    const testAppUrl = new URL(appUrl);
    testAppUrl.pathname = "/" + disposable;
    testOwner = createDatabasePool(testOwnerUrl.toString());
    testApp = createDatabasePool(testAppUrl.toString());
    await migrate(drizzle(testOwner), { migrationsFolder: "drizzle" });
    await testOwner.query(readFileSync("docker/runtime-grants.sql", "utf8"));
    await initializeReferenceData(testOwner);
    await bootstrapAccount(testOwner, process.env.OPERATOR_ACCOUNT_FILE!);
    const account = JSON.parse(
      readFileSync(process.env.OPERATOR_ACCOUNT_FILE!, "utf8"),
    );
    const user = (
      await testOwner.query("SELECT id FROM nova.users WHERE email=$1", [
        account.email,
      ])
    ).rows[0].id;
    await testOwner.query(
      "INSERT INTO nova.sessions(id,user_id,token,expires_at) VALUES($1,$2,$1,now()+interval '1 hour')",
      [randomUUID(), user],
    );
    const nextPassword = randomUUID() + randomUUID();
    const rotationFile = "/tmp/rotation-" + randomUUID() + ".json";
    writeFileSync(
      rotationFile,
      JSON.stringify({ ...account, password: nextPassword }),
      { mode: 0o600 },
    );
    try {
      await bootstrapAccount(testOwner, rotationFile, true);
    } finally {
      unlinkSync(rotationFile);
    }
    const hash = (
      await testOwner.query(
        "SELECT password FROM nova.accounts WHERE user_id=$1 AND provider_id='credential'",
        [user],
      )
    ).rows[0].password;
    assert(await verifyPassword({ hash, password: nextPassword }));
    assert.equal(
      await verifyPassword({ hash, password: account.password }),
      false,
    );
    assert.equal(
      (
        await testOwner.query(
          "SELECT count(*)::int AS n FROM nova.sessions WHERE user_id=$1",
          [user],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await testOwner.query(
          "SELECT count(*)::int AS n FROM nova.audit_events WHERE action='operator.password-rotate'",
        )
      ).rows[0].n,
      1,
    );
    console.log(
      "Operator bootstrap and password rotation passed; existing sessions revoked with audit history.",
    );
    // Fictional benchmark is restricted to this disposable database, never the production-mode app.
    await seedDemo(drizzle(testOwner, { schema }), randomUUID());
    process.env.NOVA_ALLOW_DEMO_INVOICES = "true";
    const db = drizzle(testApp, { schema });
    await inventoryFixture(db);
    await productionFixture(db);
    await salesFixture(db);
    await salesFixture(db);
    const invoice = (
      await testApp.query(
        "SELECT snapshot,total FROM nova.invoices WHERE issuance_mode='demo'",
      )
    ).rows[0];
    assert.equal(invoice.total, "7875.00");
    await forbidden(testApp, "UPDATE nova.invoices SET id=id", "P0001");
    await forbidden(testApp, "UPDATE nova.payments SET id=id", "P0001");
    assert.equal(
      (
        await testApp.query(
          "SELECT (quantity=88) AS correct FROM nova.stock_summary WHERE id='demo-finished'",
        )
      ).rows[0]?.correct,
      true,
    );
    assert.equal(
      (
        await testApp.query(
          "SELECT outstanding::text FROM nova.invoice_balances WHERE total=7875",
        )
      ).rows[0].outstanding,
      "3875.00",
    );
    await assert.rejects(assertProductionDatabase(testApp), /demonstration/);
    await testOwner.query("GRANT CREATE ON SCHEMA nova TO pandian_app");
    await testApp.query("CREATE TABLE nova.ownership_probe(id text)");
    await testOwner.query("REVOKE CREATE ON SCHEMA nova FROM pandian_app");
    await assert.rejects(
      assertProductionDatabase(testApp),
      /privileges are unsafe/,
    );
    await testApp.query("DROP TABLE nova.ownership_probe");
    console.log(
      "Non-owner runtime benchmark passed: invoice INR 7,875; dispatch leaves 88 packets; INR 4,000 payment leaves INR 3,875; duplicate fixture posting has no extra stock/payment effect. Production rejects this demo database.",
    );
    if (process.argv.includes("--keep-benchmark"))
      console.log("RECOVERY_SOURCE=" + disposable);
  }
} catch (error) {
  const cause = error instanceof Error ? (error.cause ?? error) : error;
  console.error("Production verification failed.", {
    name: error instanceof Error ? error.name : "unknown",
    code: (cause as { code?: string }).code ?? "assertion",
    detail: error instanceof assert.AssertionError ? error.message : undefined,
  });
  process.exitCode = 1;
} finally {
  await Promise.all([app.end(), owner.end(), testOwner?.end(), testApp?.end()]);
  if (
    disposable &&
    (process.exitCode === 1 || !process.argv.includes("--keep-benchmark"))
  )
    await admin.query(`DROP DATABASE "${disposable}" WITH (FORCE)`);
  await admin.end();
}
