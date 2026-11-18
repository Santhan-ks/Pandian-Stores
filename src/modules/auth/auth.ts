import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../lib/db/schema";
import { productionMode } from "../../lib/config";

export function createAuth(
  db: NodePgDatabase<typeof schema>,
  secret: string,
  baseURL: string,
) {
  if (secret.length < 32)
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  return betterAuth({
    secret,
    baseURL,
    advanced: productionMode()
      ? { ipAddress: { ipAddressHeaders: ["x-pandian-client-ip"] } }
      : undefined,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: productionMode() ? 16 : 12,
    },
    session: {
      expiresIn: 60 * 60 * 8,
      updateAge: 60 * 60,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 120,
      customRules: { "/sign-in/email": { window: 60, max: 10 } },
    },
  });
}
