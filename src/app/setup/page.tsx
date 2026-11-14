export const metadata = { title: "Setup" };

// Shown automatically while the Supabase environment variables are missing.
export default function SetupPage() {
  return (
    <main className="mx-auto max-w-2xl p-6 py-12">
      <h1 className="text-navy text-2xl font-bold">PalletPoint Storage – setup needed</h1>
      <p className="mt-2 text-sm text-gray-700">
        The app is running but is not connected to a database yet. Follow <code>README.md</code> in the project folder:
      </p>
      <ol className="mt-4 list-decimal space-y-2 pl-6 text-sm text-gray-800">
        <li>Create a Supabase project and run the SQL files in <code>supabase/migrations</code> in order.</li>
        <li>
          Copy <code>.env.example</code> to <code>.env.local</code> and fill in <code>NEXT_PUBLIC_SUPABASE_URL</code>,{" "}
          <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> and <code>SUPABASE_SECRET_KEY</code>.
        </li>
        <li>Restart the app, create your first user in Supabase and make it an admin (one line of SQL in the README).</li>
      </ol>
    </main>
  );
}
