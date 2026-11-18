import type { Pool } from "pg";

// This is an operational boundary check, not an application authorization substitute.
export async function assertProductionDatabase(pool: Pool) {
  const {
    rows: [role],
  } = await pool.query(`SELECT current_user AS name,
    rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls AS elevated,
    pg_has_role(current_user, 'pandian_owner', 'MEMBER') AS owner_member,
    has_schema_privilege(current_user, 'nova', 'CREATE') AS can_create,
    has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_schema,
    EXISTS(SELECT 1 FROM pg_auth_members WHERE member=pg_roles.oid) AS has_membership,
    EXISTS(SELECT 1 FROM pg_class WHERE relowner=pg_roles.oid) OR
      EXISTS(SELECT 1 FROM pg_proc WHERE proowner=pg_roles.oid) OR
      EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner=pg_roles.oid) AS owns_objects,
    has_database_privilege(current_user, current_database(), 'TEMP') AS can_temp
    FROM pg_roles WHERE rolname=current_user`);
  if (
    !role ||
    role.name !== "pandian_app" ||
    role.elevated ||
    role.owner_member ||
    role.can_create ||
    role.can_create_schema ||
    role.has_membership ||
    role.owns_objects ||
    role.can_temp
  )
    throw new Error("Production runtime database privileges are unsafe.");
  const {
    rows: [data],
  } = await pool.query(`SELECT
    EXISTS(SELECT 1 FROM nova.users WHERE id LIKE 'demo-%' OR email LIKE '%@example.test') OR
    EXISTS(SELECT 1 FROM nova.business_profiles WHERE mode='demo') OR
    EXISTS(SELECT 1 FROM nova.invoices WHERE issuance_mode='demo') AS has_demo`);
  if (data.has_demo)
    throw new Error("Production refuses a demonstration database.");
}
