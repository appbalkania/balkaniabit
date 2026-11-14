import Link from "next/link";
import { createGoodsIn } from "../actions";
import { requireStaff } from "@/lib/auth";
import { Card, Field, Flash, PageHeader, type SP } from "@/components/ui";
import { CustomerSelect, GoodsInLineRows } from "@/components/forms";
import { Submit } from "@/components/client";
import { todayISO } from "@/lib/format";

export const metadata = { title: "New goods in" };

export default async function NewGoodsIn({ searchParams }: { searchParams: SP }) {
  const { supabase } = await requireStaff();
  const { data: customers } = await supabase.from("customers").select("id, name, account_ref").eq("is_active", true).order("name");

  return (
    <>
      <PageHeader title="New goods in" subtitle="Record a delivery. One line per product / batch / expiry date.">
        <Link href="/admin/goods-in" className="btn btn-outline">
          Cancel
        </Link>
      </PageHeader>
      <Flash searchParams={searchParams} />
      <form action={createGoodsIn} className="space-y-5">
        <Card title="Delivery">
          <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Customer">
              <CustomerSelect customers={customers ?? []} />
            </Field>
            <Field label="Customer reference" hint="PO or delivery note number">
              <input className="input" name="reference" maxLength={60} />
            </Field>
            <Field label="Carrier / haulier">
              <input className="input" name="carrier" maxLength={60} />
            </Field>
            <Field label="Expected date">
              <input className="input" type="date" name="expected_date" defaultValue={todayISO()} />
            </Field>
            <Field label="Notes" className="sm:col-span-2 lg:col-span-4">
              <input className="input" name="notes" maxLength={300} />
            </Field>
          </div>
        </Card>
        <Card title="Goods">
          <GoodsInLineRows rows={6} />
        </Card>
        <Submit>Save delivery</Submit>
      </form>
    </>
  );
}
