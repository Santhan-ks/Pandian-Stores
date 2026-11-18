import { WorkspaceNavigation } from "@/components/workspace-navigation";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentActor } from "@/modules/auth/server";
import { AccessError, canRead, roleNames } from "@/modules/auth/policy";
import { Logout } from "@/components/logout";
import { Brand } from "@/components/brand";
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
      <div className="workspace-shell">
        <aside className="workspace-sidebar">
          <Link
            className="brand-link"
            href="/products"
            aria-label="Pandian Stores home"
          >
            <Brand />
          </Link>
          <WorkspaceNavigation
            resources={[
              "dashboard",
              "sales",
              "inventory",
              "production",
              "reports",
              "products",
              "prices",
              "boms",
              "users",
              "customers",
              "territories",
              "suppliers",
              "materials",
            ].filter((r) => canRead(actor.role, r))}
          />
          <p className="sidebar-note">
            Every order. Every batch.
            <br />
            Every movement accounted for.
          </p>
        </aside>
        <div className="workspace-body">
          <header className="workspace-topbar">
            <div>
              <span className="eyebrow">PANDIAN STORES</span>
              <p>Daily operations</p>
            </div>
            <div className="account-actions">
              <span className="role-badge">{roleNames[actor.role]}</span>
              <Logout />
            </div>
          </header>
          <main className="workspace-main" id="main-content" tabIndex={-1}>
            {children}
          </main>
          <footer className="workspace-footer">
            Pandian Stores <span>Manufacturing &amp; accounts</span>
          </footer>
        </div>
      </div>
    </>
  );
}
