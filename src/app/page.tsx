import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

// Front door: send each person to the right place for their role.
export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.profile.role === "customer") redirect(session.profile.customer_id ? "/portal" : "/pending");
  redirect("/admin");
}
