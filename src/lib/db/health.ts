import "server-only";

import { sql } from "drizzle-orm";
import { getDatabase } from "./connection";

export async function checkDatabase(): Promise<boolean> {
  try {
    const result = await getDatabase().execute(
      sql`select to_regclass('nova.system_settings') is not null as ready`,
    );
    return result.rows[0]?.ready === true;
  } catch {
    return false;
  }
}
