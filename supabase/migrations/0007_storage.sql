-- BIT Storage · 0007 · private file bucket for expense receipts (finance staff only)

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

create policy receipts_finance on storage.objects for all to authenticated
  using (bucket_id = 'receipts' and public.is_finance())
  with check (bucket_id = 'receipts' and public.is_finance());
