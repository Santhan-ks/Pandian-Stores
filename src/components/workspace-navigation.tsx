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
          prefetch={false}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path
              d={
                (
                  {
                    dashboard:
                      "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
                    sales: "M4 3h16v18l-4-2-4 2-4-2-4 2V3zM8 8h8M8 12h5",
                    inventory:
                      "m3 7 9-4 9 4v11l-9 4-9-4V7zm0 0 9 4 9-4M12 11v11",
                    production:
                      "M3 21V9l6 3V6l6 4V3h6v18H3zM7 17h1m4 0h1m4 0h1",
                    reports: "M5 3h14v18H5zM9 16v-4m3 4V8m3 8v-6",
                    products: "m4 8 8-5 8 5v10l-8 4-8-4V8zm0 0 8 5 8-5M12 13v9",
                    customers:
                      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M18 8a3 3 0 0 1 0 6m4 7v-2a4 4 0 0 0-3-4",
                  } as Record<string, string>
                )[resource] ?? "M5 4h14v16H5zM9 8h6M9 12h6M9 16h3"
              }
            />
          </svg>
          {labels[resource] ??
            resource.charAt(0).toUpperCase() + resource.slice(1)}
        </Link>
      ))}
    </nav>
  );
}
