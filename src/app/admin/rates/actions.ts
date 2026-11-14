"use server";

import { requireFinance } from "@/lib/auth";
import { back, dbMessage } from "@/lib/action";

export async function saveChargeTypes(fd: FormData) {
  const { supabase } = await requireFinance();
  const codes = fd.getAll("code").map(String);
  const names = fd.getAll("name").map((v) => String(v).trim());
  const rates = fd.getAll("default_rate").map((v) => Number(v));
  const nominals = fd.getAll("nominal_code").map(String);
  for (let i = 0; i < codes.length; i++) {
    if (!names[i]) back("/admin/rates", "error", "Every charge needs a name");
    if (!Number.isFinite(rates[i]) || rates[i] < 0) back("/admin/rates", "error", `Rate for ${names[i]} is not valid`);
    const { error } = await supabase
      .from("charge_types")
      .update({ name: names[i], default_rate: rates[i], nominal_code: nominals[i], is_active: fd.get(`active_${codes[i]}`) === "on" })
      .eq("code", codes[i]);
    if (error) back("/admin/rates", "error", dbMessage(error));
  }
  back("/admin/rates", "ok", "Rates saved");
}
