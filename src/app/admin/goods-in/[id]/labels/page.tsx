import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { requireStaff } from "@/lib/auth";
import { PrintButton } from "@/components/client";
import { fmtDate, qty, zoneLabel } from "@/lib/format";

export const metadata = { title: "Pallet labels" };

// One label per pallet, sized for A6 / 100x150mm label stock. The QR code holds the pallet label,
// so any phone or handheld scanner can read it into the pick / putaway screens.
export default async function Labels({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireStaff();
  const { data: g } = await supabase.from("goods_in").select("number, reference, received_at, customers(name, account_ref)").eq("id", id).maybeSingle();
  if (!g) notFound();
  const { data: pallets } = await supabase
    .from("pallets")
    .select("id, label, description, temp_zone, quantity, unit, batch_no, expiry_date")
    .eq("goods_in_id", id)
    .order("label");
  const customer = g.customers as unknown as { name: string; account_ref: string };
  const withQr = await Promise.all(
    (pallets ?? []).map(async (p) => ({ ...p, qr: await QRCode.toDataURL(p.label, { margin: 1, width: 220, errorCorrectionLevel: "M" }) }))
  );

  return (
    <div className="mx-auto max-w-3xl p-4">
      <div className="no-print mb-4 flex items-center justify-between">
        <h1 className="text-navy text-xl font-bold">
          Pallet labels – {g.number} ({withQr.length})
        </h1>
        <PrintButton>Print labels</PrintButton>
      </div>
      <div className="grid grid-cols-1 gap-4 print:block">
        {withQr.map((p, i) => (
          <div key={p.id} className="flex break-inside-avoid items-stretch gap-4 border-2 border-black bg-white p-4 print:mb-4 print:break-after-page">
            <div className="flex-1">
              <div className="text-xs font-semibold tracking-widest uppercase">BIT Storage</div>
              <div className="font-mono text-4xl leading-tight font-black">{p.label}</div>
              <div className="mt-2 text-xl font-bold">{customer.name}</div>
              <div className="text-lg">{p.description}</div>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div>
                  <span className="font-semibold">Storage:</span> {zoneLabel(p.temp_zone).toUpperCase()}
                </div>
                <div>
                  <span className="font-semibold">Qty:</span> {qty(p.quantity)} {p.unit}
                </div>
                <div>
                  <span className="font-semibold">Batch:</span> {p.batch_no ?? "—"}
                </div>
                <div>
                  <span className="font-semibold">Expiry:</span> {p.expiry_date ? fmtDate(p.expiry_date) : "None"}
                </div>
                <div>
                  <span className="font-semibold">Received:</span> {fmtDate(g.received_at)}
                </div>
                <div>
                  <span className="font-semibold">Ref:</span> {g.number} · {i + 1}/{withQr.length}
                </div>
              </div>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element -- inline data URL, nothing to optimise */}
            <img src={p.qr} alt={`QR code for ${p.label}`} width={150} height={150} className="self-center" />
          </div>
        ))}
      </div>
    </div>
  );
}
