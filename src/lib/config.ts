import { readFileSync, statSync } from "node:fs";

export function setting(
  name: string,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const path = env[`${name}_FILE`];
  if (path && env[name])
    throw new Error(`Configure only ${name} or ${name}_FILE.`);
  if (!path) return env[name];
  try {
    if (statSync(path).size > 8192) throw new Error();
    return readFileSync(path, "utf8").trim();
  } catch {
    throw new Error(`Unable to read ${name}_FILE.`);
  }
}

export function productionMode(
  env: Record<string, string | undefined> = process.env,
) {
  return env.NOVA_DEPLOYMENT_MODE === "production";
}

export function safeProductionPassword(value: string) {
  return (
    value.length >= 16 &&
    value.length <= 128 &&
    !/^(.)\1+$/.test(value) &&
    !["123456123456", "1234567890123456", "passwordpassword"].includes(
      value.toLowerCase(),
    )
  );
}
export function safeUrl(value: string | undefined, name: string) {
  try {
    return new URL(value ?? "");
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
}

export function validateProductionConfig(
  env: Record<string, string | undefined> = process.env,
) {
  if (!productionMode(env)) return;
  if (
    env.NOVA_ALLOW_DEMO_INVOICES !== "false" ||
    env.NOVA_ALLOW_DEMO_SEED !== "false"
  )
    throw new Error("Production requires both demo flags explicitly false.");
  const origin = safeUrl(env.BETTER_AUTH_URL, "BETTER_AUTH_URL");
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  )
    throw new Error("Production requires an HTTPS authentication origin.");
  const secret = setting("BETTER_AUTH_SECRET", env) ?? "";
  if (secret.length < 64 || new Set(secret).size < 12)
    throw new Error(
      "Production requires a random authentication secret of at least 64 characters.",
    );
  const database = safeUrl(setting("DATABASE_URL", env), "DATABASE_URL");
  if (
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    database.username !== "pandian_app" ||
    !database.password
  )
    throw new Error(
      "Production requires the dedicated pandian_app database login.",
    );
}
