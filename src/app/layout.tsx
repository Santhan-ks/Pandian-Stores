import type { Metadata } from "next";
import "./styles.css";
import { businessName } from "@/lib/brand";

export const metadata: Metadata = {
  title: { default: businessName, template: `%s | ${businessName}` },
  description:
    "Pandian Stores manufacturing, orders, stock and accounts workspace",
  icons: { icon: "/images/pandian-stores-logo.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
