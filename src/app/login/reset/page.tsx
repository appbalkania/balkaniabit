import Link from "next/link";
import { requestPasswordReset } from "../../auth-actions";
import { Field, Flash, type SP } from "@/components/ui";
import { Submit } from "@/components/client";

export const metadata = { title: "Reset password" };

export default function ResetPage({ searchParams }: { searchParams: SP }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-navy mb-1 text-xl font-bold">Reset your password</h1>
        <p className="mb-4 text-sm text-gray-600">We will email you a link to choose a new password.</p>
        <Flash searchParams={searchParams} />
        <form action={requestPasswordReset} className="space-y-4">
          <Field label="Email">
            <input className="input" type="email" name="email" autoComplete="email" required autoFocus />
          </Field>
          <Submit className="btn btn-navy w-full">Send reset link</Submit>
        </form>
        <p className="mt-4 text-center text-sm">
          <Link href="/login" className="link">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
