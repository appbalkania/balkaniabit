import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

// Client area front door: send each signed-in person to the right place for their role.
export default async function Dashboard() {
  const session = await getSession();
  if (!session) redirect("/login?next=/dashboard");
  if (session.profile.role === "customer") redirect(session.profile.customer_id ? "/portal" : "/pending");
  redirect("/admin");
}
