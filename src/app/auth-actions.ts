"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { back, str } from "@/lib/action";
import { APP_URL } from "@/lib/email";

export async function signIn(formData: FormData) {
  const email = str(formData, "email").toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = str(formData, "next");
  if (!email || !password) back("/login", "error", "Enter your email and password");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) back("/login", "error", "Email or password is incorrect");

  // only follow same-site paths
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordReset(formData: FormData) {
  const email = str(formData, "email").toLowerCase();
  if (!email) back("/login/reset", "error", "Enter your email address");
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${APP_URL}/auth/callback?next=/account` });
  // same message whether or not the address exists
  back("/login", "ok", "If that address has an account, a reset link is on its way");
}

export async function changePassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 10) back("/account", "error", "Use at least 10 characters");
  if (password !== confirm) back("/account", "error", "The two passwords do not match");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { error } = await supabase.auth.updateUser({ password });
  if (error) back("/account", "error", error.message);
  back("/account", "ok", "Password updated");
}
