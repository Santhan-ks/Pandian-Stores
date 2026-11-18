import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import type { Pool } from "pg";
import { safeProductionPassword } from "../../src/lib/config";

const input = z
  .object({
    name: z.string().trim().min(2).max(160),
    email: z
      .email()
      .toLowerCase()
      .refine((v) => !v.endsWith("@example.test")),
    password: z.string().refine(safeProductionPassword),
  })
  .strict();

export async function bootstrapAccount(
  pool: Pool,
  file: string,
  rotate = false,
) {
  const account = input.parse(JSON.parse(readFileSync(file, "utf8")));
  const password = await hashPassword(account.password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('nova-user-management',0))",
    );
    const existing = await client.query(
      "SELECT id FROM nova.users WHERE email=$1",
      [account.email],
    );
    let id: string;
    if (rotate) {
      if (!existing.rowCount) throw new Error("Account not found.");
      id = existing.rows[0].id;
      const changed = await client.query(
        "UPDATE nova.accounts SET password=$1,updated_at=now() WHERE user_id=$2 AND provider_id='credential'",
        [password, id],
      );
      if (changed.rowCount !== 1)
        throw new Error("Expected one credential account.");
      await client.query("DELETE FROM nova.sessions WHERE user_id=$1", [id]);
    } else {
      const count = await client.query(
        "SELECT count(*)::int AS n FROM nova.users",
      );
      if (count.rows[0].n !== 0)
        throw new Error("Bootstrap requires an empty user table.");
      id = randomUUID();
      await client.query(
        "INSERT INTO nova.users(id,name,email,email_verified) VALUES($1,$2,$3,false)",
        [id, account.name, account.email],
      );
      await client.query(
        "INSERT INTO nova.accounts(id,user_id,account_id,provider_id,password) VALUES($1,$2,$2,'credential',$3)",
        [randomUUID(), id, password],
      );
      await client.query(
        "INSERT INTO nova.user_roles(user_id,role) VALUES($1,'admin')",
        [id],
      );
    }
    await client.query(
      "INSERT INTO nova.audit_events(id,actor_id,action,document_id) VALUES($1,$2,$3,$2)",
      [
        randomUUID(),
        id,
        rotate ? "operator.password-rotate" : "operator.bootstrap",
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
