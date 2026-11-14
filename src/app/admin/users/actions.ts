"use server";

import { requireAdmin } from "@/lib/auth";
import { back, isUuid, str } from "@/lib/action";
import { createAdminClient } from "@/lib/supabase/server";
import { APP_URL } from "@/lib/email";

const P = "/admin/users";
const ROLES = ["admin", "accounts", "warehouse", "customer"];

export async function inviteStaff(fd: FormData) {
  await requireAdmin();
  const email = str(fd, "email").toLowerCase();
  const role = str(fd, "role");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) back(P, "error", "Enter a valid email");
  if (!["admin", "accounts", "warehouse"].includes(role)) back(P, "error", "Choose a role");
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: str(fd, "full_name") },
    redirectTo: `${APP_URL}/auth/callback?next=/account`,
  });
  if (error || !data.user) back(P, "error", error?.message ?? "Invite failed");
  await admin.from("profiles").update({ role, full_name: str(fd, "full_name") || null, customer_id: null }).eq("id", data.user.id);
  back(P, "ok", `Invitation sent to ${email}`);
}

export async function updateUser(fd: FormData) {
  const { user } = await requireAdmin();
  const id = str(fd, "id");
  const role = str(fd, "role");
  const customerId = str(fd, "customer_id");
  if (!isUuid(id) || !ROLES.includes(role)) back(P, "error", "Invalid change");
  if (id === user.id && role !== "admin") back(P, "error", "You cannot remove your own admin access");
  if (role === "customer" && customerId && !isUuid(customerId)) back(P, "error", "Choose a customer");
  const admin = createAdminClient();
  await admin
    .from("profiles")
    .update({ role, customer_id: role === "customer" ? customerId || null : null })
    .eq("id", id);
  back(P, "ok", "User updated");
}

export async function removeUser(fd: FormData) {
  const { user } = await requireAdmin();
  const id = str(fd, "id");
  if (id === user.id) back(P, "error", "You cannot delete yourself");
  const { error } = await createAdminClient().auth.admin.deleteUser(id);
  if (error) back(P, "error", `Could not delete: ${error.message}. If they have recorded stock or invoices, change their role to "customer" with no customer instead - that removes all access.`);
  back(P, "ok", "Login deleted");
}
