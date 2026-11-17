import Link from "next/link";
import { redirect } from "next/navigation";
import { currentActor } from "@/modules/auth/server";
import { AccessError, canRead, roleNames } from "@/modules/auth/policy";
import { Logout } from "@/components/logout";
export const dynamic = "force-dynamic";
export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let actor;
  try {
    actor = await currentActor();
  } catch (error) {
    if (error instanceof AccessError && error.status === 401)
      redirect("/login");
    throw error;
  }
  return (
    <>
      <header>
        <Link href="/products">NOVA</Link>
        <span>{roleNames[actor.role]}</span>
        <Logout />
      </header>
      <nav aria-label="Main navigation">
        {[
          "users",
          "customers",
          "territories",
          "suppliers",
          "materials",
          "products",
          "prices",
          "boms",
          "inventory",
        ]
          .filter((r) => canRead(actor.role, r))
          .map((r) => (
            <Link href={"/" + r} key={r}>
              {r === "boms" ? "BOMs" : r.charAt(0).toUpperCase() + r.slice(1)}
            </Link>
          ))}
      </nav>
      <main>{children}</main>
    </>
  );
}
