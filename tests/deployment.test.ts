import { test, expect, afterAll } from "vitest";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  rmdirSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  setting,
  validateProductionConfig,
  safeProductionPassword,
  safeUrl,
} from "../src/lib/config";
import {
  encryptBackup,
  verifyBackup,
  decryptBackup,
} from "../scripts/lib/encrypted-backup";
import {
  allowProxyLogin,
  allowLogin,
  clientNetwork,
} from "../src/modules/auth/login-limit";
import * as schema from "../src/lib/db/schema";

const folder = mkdtempSync(join(tmpdir(), "pandian-deployment-test-"));
afterAll(() => {
  for (const name of readdirSync(folder)) unlinkSync(join(folder, name));
  rmdirSync(folder);
});
const valid: Record<string, string | undefined> = {
  NOVA_DEPLOYMENT_MODE: "production",
  NOVA_ALLOW_DEMO_SEED: "false",
  NOVA_ALLOW_DEMO_INVOICES: "false",
  BETTER_AUTH_URL: "https://localhost:3443",
  BETTER_AUTH_SECRET: randomBytes(48).toString("hex"),
  DATABASE_URL: "postgresql://pandian_app:generated@db:5432/pandian",
};
test("file secrets reject ambiguity and sanitize file failures", () => {
  const path = join(folder, "secret");
  writeFileSync(path, "private\n");
  expect(setting("KEY", { KEY_FILE: path })).toBe("private");
  expect(() => setting("KEY", { KEY_FILE: path, KEY: "other" })).toThrow(
    /only/,
  );
  expect(() => setting("KEY", { KEY_FILE: join(folder, "missing") })).toThrow(
    "Unable to read KEY_FILE.",
  );
  expect(() =>
    safeUrl("postgresql://user:PRIVATE_SECRET@bad[host]", "DATABASE_URL"),
  ).toThrow("DATABASE_URL must be a valid URL.");
});
test("production refuses HTTP, owner credentials, weak secrets and demo opt-ins", () => {
  expect(() => validateProductionConfig(valid)).not.toThrow();
  for (const change of [
    { BETTER_AUTH_URL: "http://localhost:3443" },
    { BETTER_AUTH_URL: "https://localhost/path" },
    { DATABASE_URL: "postgresql://pandian_owner:secret@db/pandian" },
    { BETTER_AUTH_SECRET: "a".repeat(96) },
    { NOVA_ALLOW_DEMO_INVOICES: "true" },
    { NOVA_ALLOW_DEMO_SEED: "true" },
    { NOVA_ALLOW_DEMO_SEED: undefined },
  ])
    expect(() => validateProductionConfig({ ...valid, ...change })).toThrow();
});
test("production credentials reject published demo and trivial passwords", () => {
  for (const password of [
    "123456",
    "123456123456",
    "passwordpassword",
    "a".repeat(40),
  ])
    expect(safeProductionPassword(password)).toBe(false);
  expect(safeProductionPassword(randomBytes(24).toString("hex"))).toBe(true);
});
test("proxy identity normalizes mapped IPv4 and IPv6 subnets without trusting alternate spellings", () => {
  expect(clientNetwork("::ffff:192.0.2.7")).toBe(clientNetwork("192.0.2.7"));
  expect(clientNetwork("2001:db8:abcd:12::1")).toBe(
    clientNetwork("2001:0db8:abcd:0012:ffff::2"),
  );
  expect(clientNetwork("2001:db8:abcd:13::1")).not.toBe(
    clientNetwork("2001:db8:abcd:12::1"),
  );
  expect(() => clientNetwork("192.0.2.1, 198.51.100.2")).toThrow(
    /trusted proxy/,
  );
});
test("encrypted backups round-trip without storing plaintext; authentication rejects corruption and wrong keys", async () => {
  const plain = randomBytes(200_000),
    key = randomBytes(32).toString("hex"),
    path = join(folder, "dump.enc");
  await encryptBackup(Readable.from(plain), path, key);
  expect(readFileSync(path).includes(plain.subarray(0, 64))).toBe(false);
  await verifyBackup(path, key);
  const chunks: Buffer[] = [];
  await decryptBackup(
    path,
    key,
    new Writable({
      write(chunk, _encoding, done) {
        chunks.push(chunk);
        done();
      },
    }),
  );
  expect(Buffer.concat(chunks)).toEqual(plain);
  await expect(
    verifyBackup(path, randomBytes(32).toString("hex")),
  ).rejects.toThrow();
  const altered = readFileSync(path);
  altered[50] ^= 1;
  writeFileSync(path, altered);
  await expect(verifyBackup(path, key)).rejects.toThrow();
});
test("incomplete/unsupported backup files and invalid keys cannot be restored", async () => {
  const failed = join(folder, "failed-dump.enc");
  const interrupted = Readable.from(
    (async function* () {
      yield Buffer.from("partial data");
      throw new Error("simulated dump failure");
    })(),
  );
  await expect(
    encryptBackup(interrupted, failed, randomBytes(32).toString("hex")),
  ).rejects.toThrow(/dump failure/);
  expect(existsSync(failed)).toBe(false);
  const path = join(folder, "bad.partial");
  writeFileSync(path, randomBytes(50));
  await expect(
    verifyBackup(path, randomBytes(32).toString("hex")),
  ).rejects.toThrow(/Incomplete/);
  await expect(
    encryptBackup(Readable.from("data"), join(folder, "bad-key"), "123456"),
  ).rejects.toThrow(/Backup key/);
});
test("production proxy login limits persist across callers, do not trust a forwarded-for list, and reject missing proxy identity", async () => {
  const old = process.env.NOVA_DEPLOYMENT_MODE;
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  try {
    process.env.NOVA_DEPLOYMENT_MODE = "production";
    const db = drizzle(pool, { schema }),
      secret = randomUUID(),
      headers = new Headers({
        "x-pandian-client-ip": "192.0.2.7",
        "x-forwarded-for": "198.51.100.9",
      });
    const results = await Promise.all(
      Array.from({ length: 34 }, () => allowProxyLogin(db, headers, secret)),
    );
    expect(results.filter(Boolean)).toHaveLength(30);
    // Exhaust only this test's deployment-wide bucket, then vary the client IP.
    const globalKey = createHmac("sha256", secret)
      .update("global:login")
      .digest("hex");
    await pool.query(
      "UPDATE nova.login_attempts SET attempts=300 WHERE key=$1",
      [globalKey],
    );
    expect(
      await allowProxyLogin(
        db,
        new Headers({ "x-pandian-client-ip": "198.51.100.22" }),
        secret,
      ),
    ).toBe(false);
    // Account text cannot collide with the global or IP namespaces.
    expect(await allowLogin(db, "global:login", secret)).toBe(true);
    expect(
      await allowProxyLogin(drizzle(pool, { schema }), headers, secret),
    ).toBe(false);
    await expect(
      allowProxyLogin(
        db,
        new Headers({ "x-forwarded-for": "198.51.100.9" }),
        secret,
      ),
    ).rejects.toThrow(/trusted proxy/);
  } finally {
    if (old === undefined) delete process.env.NOVA_DEPLOYMENT_MODE;
    else process.env.NOVA_DEPLOYMENT_MODE = old;
    await pool.end();
  }
});
