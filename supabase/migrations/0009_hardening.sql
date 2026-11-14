-- BIT Storage · 0009 · hardening (Supabase security advisor)
-- 1. Pin search_path on every function so a caller cannot shadow public objects.
-- 2. handle_new_user() is a trigger only; nobody should call it through the API.

alter function public.local_date(timestamptz) set search_path = public;
alter function public.today() set search_path = public;
alter function public.receive_goods_in(uuid, timestamptz) set search_path = public;
alter function public.putaway_pallet(uuid, uuid) set search_path = public;
alter function public.putaway_line(bigint, uuid) set search_path = public;
alter function public.refresh_goods_out_status(uuid) set search_path = public;
alter function public.allocate_goods_out(uuid) set search_path = public;
alter function public.allocate_pallet(uuid, uuid) set search_path = public;
alter function public.deallocate_pallet(uuid) set search_path = public;
alter function public.pick_pallet(uuid) set search_path = public;
alter function public.dispatch_goods_out(uuid, text, timestamptz) set search_path = public;
alter function public.cancel_goods_out(uuid) set search_path = public;
alter function public.check_journal_balanced() set search_path = public;
alter function public.post_expense() set search_path = public;
alter function public.unpost_expense() set search_path = public;
alter function public.lock_expense() set search_path = public;
alter function public.report_trial_balance(date, date) set search_path = public;
alter function public.rate_for(uuid, text) set search_path = public;
alter function public.pallets_in_store(uuid, public.temp_zone, date, date) set search_path = public;
alter function public.bill_customer_week(uuid, date, uuid) set search_path = public;
alter function public.run_weekly_billing(date) set search_path = public;
alter function public.record_payment(uuid, numeric, text, text, date, text) set search_path = public;
alter function public.void_invoice(uuid) set search_path = public;
alter function public.report_vat_return(date, date) set search_path = public;

revoke execute on function public.handle_new_user() from authenticated, anon, public;
