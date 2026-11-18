"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
const labels: Record<string, string> = {
  boms: "BOMs",
  dashboard: "Owner dashboard",
  prices: "Prices",
  inventory: "Inventory",
  production: "Production",
  sales: "Sales",
  reports: "Reports",
};
export function WorkspaceNavigation({ resources }: { resources: string[] }) {
  const path = usePathname(),
    section = path.split("/")[1];
  return (
    <nav className="workspace-navigation" aria-label="Main navigation">
      {resources.map((resource) => (
        <Link
          className="nav-link"
          aria-current={section === resource ? "page" : undefined}
          key={resource}
          href={"/" + resource}
        >
          {labels[resource] ??
            resource.charAt(0).toUpperCase() + resource.slice(1)}
        </Link>
      ))}
    </nav>
  );
}
