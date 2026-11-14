import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

export type Role = "admin" | "accounts" | "warehouse" | "customer";
export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
  customer_id: string | null;
};

/** Verified user + profile for this request (one lookup per request). */
export const getSession = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, customer_id")
    .eq("id", user.id)
    .single();
  if (!profile) return null;
  return { supabase, user, profile: profile as Profile };
});

/** Staff pages and actions. `roles` narrows further; admins always pass. */
export async function requireStaff(roles?: Role[]) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { role } = session.profile;
  if (role === "customer") redirect("/portal");
  if (roles && role !== "admin" && !roles.includes(role)) {
    redirect("/admin?error=" + encodeURIComponent("You do not have access to that area"));
  }
  return session;
}

export const requireFinance = () => requireStaff(["accounts"]);
export const requireAdmin = () => requireStaff([]);

/** Customer portal pages and actions. */
export async function requireCustomer() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.profile.role !== "customer") redirect("/admin");
  if (!session.profile.customer_id) redirect("/pending");
  return { ...session, customerId: session.profile.customer_id };
}
