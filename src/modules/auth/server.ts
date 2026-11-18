import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/db/connection";
import { userRoles } from "@/lib/db/schema";
import { createAuth } from "./auth";
import { AccessError, type Actor, type Role } from "./policy";
import { setting } from "@/lib/config";

let auth: ReturnType<typeof createAuth> | undefined;
export async function pageActor() {
  try {
    return await currentActor();
  } catch (error) {
    if (error instanceof AccessError && error.status === 401)
      redirect("/login");
    throw error;
  }
}
export function getAuth() {
  if (!auth)
    auth = createAuth(
      getDatabase(),
      setting("BETTER_AUTH_SECRET") ?? "",
      process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    );
  return auth;
}
export async function currentActor(requestHeaders?: Headers): Promise<Actor> {
  const result = await getAuth().api.getSession({
    headers: requestHeaders ?? (await headers()),
  });
  if (!result)
    throw new AccessError(401, "Your session has expired. Please sign in.");
  const [assigned] = await getDatabase()
    .select()
    .from(userRoles)
    .where(eq(userRoles.userId, result.user.id));
  if (!assigned) throw new AccessError(403, "No role has been assigned.");
  return { id: result.user.id, role: assigned.role as Role };
}
