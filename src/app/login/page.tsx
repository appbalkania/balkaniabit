import Image from "next/image";
import Link from "next/link";
import { signIn } from "../auth-actions";
import { Field, Flash, first, type SP } from "@/components/ui";
import { Submit } from "@/components/client";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: SP }) {
  const next = first((await searchParams).next);
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6">
        <Image src="/bit-storage-logo.jpeg" alt="BIT Storage – part of Balkania Group" width={320} height={160} preload className="mx-auto mb-4 h-auto w-56" />
        <Flash searchParams={searchParams} />
        <form action={signIn} className="space-y-4">
          <input type="hidden" name="next" value={next} />
          <Field label="Email">
            <input className="input" type="email" name="email" autoComplete="email" required autoFocus />
          </Field>
          <Field label="Password">
            <input className="input" type="password" name="password" autoComplete="current-password" required />
          </Field>
          <Submit className="btn btn-navy w-full" pendingText="Signing in…">
            Sign in
          </Submit>
        </form>
        <p className="mt-4 text-center text-sm">
          <Link href="/login/reset" className="link">
            Forgotten your password?
          </Link>
        </p>
      </div>
    </main>
  );
}
