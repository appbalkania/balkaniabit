import type { ReactNode } from "react";
import { requireCustomer } from "@/lib/auth";
import { Shell } from "@/components/shell";

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const { supabase, profile, customerId } = await requireCustomer();
  const { data: c } = await supabase.from("customers").select("name").eq("id", customerId).single();
  return (
    <Shell
      badge={c?.name ?? "Customer"}
      user={profile.email ?? ""}
      nav={[
        { items: [{ href: "/portal", label: "Overview", exact: true }] },
        {
          title: "My stock",
          items: [
            { href: "/portal/stock", label: "Stock & expiry" },
            { href: "/portal/deliveries", label: "Deliveries in" },
            { href: "/portal/collections", label: "Collections" },
          ],
        },
        {
          title: "Account",
          items: [
            { href: "/portal/invoices", label: "Invoices" },
            { href: "/portal/payment", label: "Payment details" },
          ],
        },
      ]}
    >
      {children}
    </Shell>
  );
}
