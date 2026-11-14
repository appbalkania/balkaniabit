import type { ReactNode } from "react";
import { requireStaff } from "@/lib/auth";
import { Shell, type NavSection } from "@/components/shell";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireStaff();
  const finance = profile.role === "admin" || profile.role === "accounts";

  const nav: NavSection[] = [
    { items: [{ href: "/admin", label: "Dashboard", exact: true }] },
    {
      title: "Warehouse",
      items: [
        { href: "/admin/goods-in", label: "Goods in" },
        { href: "/admin/goods-out", label: "Goods out" },
        { href: "/admin/pick", label: "Pick list" },
        { href: "/admin/stock", label: "Stock" },
        { href: "/admin/expiry", label: "Expiry dates" },
        { href: "/admin/locations", label: "Locations" },
      ],
    },
  ];
  if (finance) {
    nav.push(
      { title: "Customers", items: [{ href: "/admin/customers", label: "Customers" }] },
      {
        title: "Billing",
        items: [
          { href: "/admin/invoices", label: "Invoices" },
          { href: "/admin/billing", label: "Weekly billing" },
          { href: "/admin/rates", label: "Rates" },
        ],
      },
      {
        title: "Accounts",
        items: [
          { href: "/admin/expenses", label: "Expenses" },
          { href: "/admin/reports/pnl", label: "Profit & loss" },
          { href: "/admin/reports/balance-sheet", label: "Balance sheet" },
          { href: "/admin/reports/vat", label: "VAT return" },
          { href: "/admin/nominal", label: "Nominal codes" },
          { href: "/admin/journals", label: "Journals" },
          { href: "/admin/sage", label: "Sage" },
        ],
      }
    );
  }
  if (profile.role === "admin") {
    nav.push({
      title: "Admin",
      items: [
        { href: "/admin/users", label: "Users" },
        { href: "/admin/settings", label: "Settings" },
      ],
    });
  }

  return (
    <Shell nav={nav} user={profile.email ?? ""} badge={`${profile.role} · staff`}>
      {children}
    </Shell>
  );
}
