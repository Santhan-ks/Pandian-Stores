import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "../catalog/service";
import { isIP } from "node:net";
import { productionMode } from "../../lib/config";
import { AccessError } from "./policy";
// Account keys are HMACs, not emails. Atomic upsert prevents parallel attempts bypassing the limit.
export async function allowLogin(db: Database, email: unknown, secret: string) {
  const account =
    typeof email === "string" && email.length <= 254
      ? email.trim().toLowerCase()
      : "invalid";
  return allowKey(db, `account:${account}`, secret, 10);
}

// The production proxy overwrites this header; the app has no published port.
export async function allowProxyLogin(
  db: Database,
  headers: Headers,
  secret: string,
) {
  if (!productionMode()) return true;
  const ip = headers.get("x-pandian-client-ip") ?? "";
  const network = clientNetwork(ip);
  if (!(await allowKey(db, "global:login", secret, 300))) return false;
  return allowKey(db, `ip:${network}`, secret, 30);
}

export function clientNetwork(ip: string) {
  const family = isIP(ip);
  if (!family || ip.includes("%"))
    throw new AccessError(403, "A trusted proxy is required.");
  if (family === 4) return ip;
  // Group IPv6 /64 clients so rotating interface addresses cannot reset the limit.
  const canonical = new URL(`http://[${ip}]`).hostname.slice(1, -1);
  const [left, right = ""] = canonical.split("::");
  const head = left.split(":").filter(Boolean),
    tail = right.split(":").filter(Boolean);
  const groups = [
    ...head,
    ...Array<string>(8 - head.length - tail.length).fill("0"),
    ...tail,
  ].map((v) => Number.parseInt(v, 16));
  if (groups.slice(0, 5).every((v) => v === 0) && groups[5] === 65535)
    return [
      groups[6] >> 8,
      groups[6] & 255,
      groups[7] >> 8,
      groups[7] & 255,
    ].join(".");
  return (
    groups
      .slice(0, 4)
      .map((v) => v.toString(16).padStart(4, "0"))
      .join(":") + "::/64"
  );
}

async function allowKey(
  db: Database,
  identity: string,
  secret: string,
  limit: number,
) {
  const key = createHmac("sha256", secret).update(identity).digest("hex");
  await db.execute(
    sql`DELETE FROM nova.login_attempts WHERE expires_at<now()-interval '10 minutes'`,
  );
  const row = (
    await db.execute(
      sql`INSERT INTO nova.login_attempts(key,attempts,expires_at) VALUES(${key},1,now()+interval '60 seconds') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN nova.login_attempts.expires_at<=now() THEN 1 ELSE least(nova.login_attempts.attempts,1000)+1 END,expires_at=CASE WHEN nova.login_attempts.expires_at<=now() THEN now()+interval '60 seconds' ELSE nova.login_attempts.expires_at END RETURNING attempts`,
    )
  ).rows[0];
  return Number(row.attempts) <= limit;
}
