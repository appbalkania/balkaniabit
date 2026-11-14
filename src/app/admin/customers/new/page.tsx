import Link from "next/link";
import { createCustomer } from "../actions";
import { CustomerFields } from "../fields";
import { requireFinance } from "@/lib/auth";
import { Card, Flash, PageHeader, type SP } from "@/components/ui";
import { Submit } from "@/components/client";

export const metadata = { title: "New customer" };

export default async function NewCustomer({ searchParams }: { searchParams: SP }) {
  const { supabase } = await requireFinance();
  const { data: taxCodes } = await supabase.from("tax_codes").select("code, description").order("code");
  return (
    <>
      <PageHeader title="New customer">
        <Link href="/admin/customers" className="btn btn-outline">
          Cancel
        </Link>
      </PageHeader>
      <Flash searchParams={searchParams} />
      <form action={createCustomer}>
        <Card>
          <CustomerFields taxCodes={taxCodes ?? []} isNew />
        </Card>
        <div className="mt-4">
          <Submit>Create customer</Submit>
        </div>
      </form>
    </>
  );
}
