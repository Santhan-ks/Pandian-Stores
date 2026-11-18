import { createDatabasePool } from "../src/lib/db/pool";
import { setting } from "../src/lib/config";
import { bootstrapAccount } from "./lib/operator-account";
const pool = createDatabasePool(setting("DATABASE_URL") ?? "");
try {
  await bootstrapAccount(pool, process.env.OPERATOR_ACCOUNT_FILE ?? "", true);
  console.log(
    "Credential rotated, all account sessions revoked, audit event recorded.",
  );
} catch {
  console.error(
    "Credential rotation failed; check the private operator account file.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
