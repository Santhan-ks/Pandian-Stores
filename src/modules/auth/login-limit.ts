import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "../catalog/service";
// Account keys are HMACs, not emails. Atomic upsert prevents parallel attempts bypassing the limit.
export async function allowLogin(db: Database, email: unknown, secret: string) {
  const account =
    typeof email === "string" && email.length <= 254
      ? email.trim().toLowerCase()
      : "invalid";
  const key = createHmac("sha256", secret).update(account).digest("hex");
  await db.execute(
    sql`DELETE FROM nova.login_attempts WHERE expires_at<now()-interval '10 minutes'`,
  );
  const row = (
    await db.execute(
      sql`INSERT INTO nova.login_attempts(key,attempts,expires_at) VALUES(${key},1,now()+interval '60 seconds') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN nova.login_attempts.expires_at<=now() THEN 1 ELSE nova.login_attempts.attempts+1 END,expires_at=CASE WHEN nova.login_attempts.expires_at<=now() THEN now()+interval '60 seconds' ELSE nova.login_attempts.expires_at END RETURNING attempts`,
    )
  ).rows[0];
  return Number(row.attempts) <= 10;
}
