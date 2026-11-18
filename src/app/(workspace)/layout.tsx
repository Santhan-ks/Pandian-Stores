import { WorkspaceNavigation } from "@/components/workspace-navigation";
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
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header>
        <Link href="/products">NOVA</Link>
        <span>{roleNames[actor.role]}</span>
        <Logout />
      </header>
      <WorkspaceNavigation
        resources={[
          "users",
          "customers",
          "territories",
          "suppliers",
          "materials",
          "products",
          "prices",
          "boms",
          "inventory",
          "production",
          "sales",
          "reports",
          "dashboard",
        ].filter((r) => canRead(actor.role, r))}
      />
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
    </>
  );
}
