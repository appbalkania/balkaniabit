import { signOut } from "../auth-actions";

export const metadata = { title: "Account pending" };

export default function PendingPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card max-w-md p-6 text-center">
        <h1 className="text-navy text-xl font-bold">Your account is being set up</h1>
        <p className="mt-2 text-sm text-gray-600">
          Your login works, but it has not been linked to a customer account yet. Please contact PalletPoint Storage and we will
          finish setting you up.
        </p>
        <form action={signOut} className="mt-4">
          <button className="btn btn-outline">Sign out</button>
        </form>
      </div>
    </main>
  );
}
