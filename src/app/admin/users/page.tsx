import { inviteStaff, removeUser, updateUser } from "./actions";
import { requireAdmin } from "@/lib/auth";
import { Card, Field, Flash, PageHeader, TableWrap, type SP } from "@/components/ui";
import { Submit } from "@/components/client";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Users" };

const ROLE_HELP: Record<string, string> = {
  admin: "Everything, including users and settings",
  accounts: "Customers, invoices, expenses, reports, Sage + warehouse",
  warehouse: "Goods in/out, picking, stock, locations. No money.",
  customer: "Customer portal only (needs a customer)",
};

export default async function Users({ searchParams }: { searchParams: SP }) {
  const { supabase, user } = await requireAdmin();
  const [{ data: users }, { data: customers }] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name, role, customer_id, created_at").order("role").order("email"),
    supabase.from("customers").select("id, name").order("name"),
  ]);

  return (
    <>
      <PageHeader title="Users" subtitle="Who can sign in, and what they can see" />
      <Flash searchParams={searchParams} />
      <Card title="Invite a staff member" className="mb-5">
        <form action={inviteStaff} className="grid gap-3 p-4 sm:grid-cols-4">
          <Field label="Name">
            <input className="input" name="full_name" maxLength={80} />
          </Field>
          <Field label="Email">
            <input className="input" type="email" name="email" required />
          </Field>
          <Field label="Role">
            <select className="input" name="role" defaultValue="warehouse">
              <option value="warehouse">Warehouse</option>
              <option value="accounts">Accounts</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
          <div className="flex items-end">
            <Submit className="btn btn-navy w-full">Send invitation</Submit>
          </div>
        </form>
        <p className="px-4 pb-3 text-xs text-gray-500">Customer logins are invited from the customer&apos;s own page.</p>
      </Card>
      <Card>
        <TableWrap>
          <table className="tbl">
            <thead>
              <tr>
                <th>User</th>
                <th>Role / customer</th>
                <th>Added</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(users ?? []).map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.full_name ? <div className="font-medium">{u.full_name}</div> : null}
                    <div className="text-gray-600">{u.email}</div>
                  </td>
                  <td>
                    <form action={updateUser} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={u.id} />
                      <select className="input w-32" name="role" defaultValue={u.role} aria-label="Role" title={ROLE_HELP[u.role]}>
                        {Object.keys(ROLE_HELP).map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <select className="input w-48" name="customer_id" defaultValue={u.customer_id ?? ""} aria-label="Customer">
                        <option value="">{u.role === "customer" ? "— no access —" : "—"}</option>
                        {(customers ?? []).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <Submit className="btn btn-outline btn-sm">Save</Submit>
                    </form>
                  </td>
                  <td>{fmtDate(u.created_at)}</td>
                  <td>
                    {u.id !== user.id ? (
                      <form action={removeUser}>
                        <input type="hidden" name="id" value={u.id} />
                        <Submit className="btn btn-danger btn-sm" confirm={`Delete the login for ${u.email}?`}>
                          Delete
                        </Submit>
                      </form>
                    ) : (
                      <span className="text-xs text-gray-500">you</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </>
  );
}
