import Link from "next/link";
import { preAdviseDelivery } from "../../actions";
import { requireCustomer } from "@/lib/auth";
import { Card, Field, Flash, PageHeader, type SP } from "@/components/ui";
import { GoodsInLineRows } from "@/components/forms";
import { Submit } from "@/components/client";
import { todayISO } from "@/lib/format";

export const metadata = { title: "Pre-advise a delivery" };

export default async function PreAdvise({ searchParams }: { searchParams: SP }) {
  await requireCustomer();
  return (
    <>
      <PageHeader title="Pre-advise a delivery" subtitle="Tell us what is coming so we can have space ready.">
        <Link href="/portal/deliveries" className="btn btn-outline">
          Cancel
        </Link>
      </PageHeader>
      <Flash searchParams={searchParams} />
      <form action={preAdviseDelivery} className="space-y-5">
        <Card title="Delivery">
          <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Arriving on">
              <input className="input" type="date" name="expected_date" min={todayISO()} defaultValue={todayISO()} required />
            </Field>
            <Field label="Your reference / PO">
              <input className="input" name="reference" maxLength={60} />
            </Field>
            <Field label="Haulier">
              <input className="input" name="carrier" maxLength={60} />
            </Field>
            <Field label="Notes">
              <input className="input" name="notes" maxLength={300} />
            </Field>
          </div>
        </Card>
        <Card title="Goods">
          <GoodsInLineRows rows={4} />
        </Card>
        <Submit>Send to BIT Storage</Submit>
      </form>
    </>
  );
}
