import Link from "next/link";
import { redirect } from "next/navigation";
import { changePassword, signOut } from "../auth-actions";
import { getSession } from "@/lib/auth";
import { Card, Field, Flash, PageHeader, type SP } from "@/components/ui";
import { Submit } from "@/components/client";

export const metadata = { title: "My account" };

export default async function AccountPage({ searchParams }: { searchParams: SP }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const home = session.profile.role === "customer" ? "/portal" : "/admin";
  return (
    <main className="mx-auto max-w-md p-4 py-10">
      <PageHeader title="My account" subtitle={session.profile.email}>
        <Link href={home} className="btn btn-outline">
          Back
        </Link>
      </PageHeader>
      <Flash searchParams={searchParams} />
      <Card title="Change password">
        <form action={changePassword} className="space-y-4 p-4">
          <Field label="New password" hint="At least 10 characters">
            <input className="input" type="password" name="password" autoComplete="new-password" minLength={10} required />
          </Field>
          <Field label="Repeat new password">
            <input className="input" type="password" name="confirm" autoComplete="new-password" minLength={10} required />
          </Field>
          <Submit>Update password</Submit>
        </form>
      </Card>
      <form action={signOut} className="mt-4">
        <button className="btn btn-outline">Sign out</button>
      </form>
    </main>
  );
}
