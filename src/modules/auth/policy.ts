export const roleNames = {
  salesman: "Salesman",
  admin: "Factory Admin",
  production: "Production Supervisor",
  auditor: "Accountant / Auditor",
  owner: "Owner",
} as const;
export type Role = keyof typeof roleNames;
export type Actor = { id: string; role: Role };
export class AccessError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function canRead(role: Role, resource: string) {
  if (resource === "production") return role !== "salesman";
  if (resource === "inventory") return role !== "salesman";
  if (resource === "users") return ["admin", "owner", "auditor"].includes(role);
  if (resource === "customers") return role !== "production";
  if (resource === "territories")
    return role === "admin" || role === "owner" || role === "auditor";
  if (
    resource === "suppliers" ||
    resource === "materials" ||
    resource === "boms"
  )
    return role !== "salesman";
  return true;
}
export function canWrite(role: Role, resource: string) {
  return (
    role === "admin" ||
    (role === "production" &&
      ["suppliers", "materials", "boms"].includes(resource))
  );
}
export function authorize(
  actor: Actor | null,
  resource: string,
  write = false,
): asserts actor is Actor {
  if (!actor) throw new AccessError(401, "Please sign in.");
  if (!(write ? canWrite(actor.role, resource) : canRead(actor.role, resource)))
    throw new AccessError(
      403,
      "You do not have permission for this operation.",
    );
}
