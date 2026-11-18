import type { Pool } from "pg";
import { roleNames } from "../../src/modules/auth/policy";
import { unitDefinitions } from "../../src/lib/units/convert";

export async function initializeReferenceData(pool: Pool) {
  for (const [code, name] of Object.entries(roleNames))
    await pool.query(
      "INSERT INTO nova.roles(code,name) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [code, name],
    );
  for (const [code, [dimension, factor]] of Object.entries(unitDefinitions))
    await pool.query(
      "INSERT INTO nova.units(code,dimension,base_factor) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [code, dimension, factor],
    );
}
