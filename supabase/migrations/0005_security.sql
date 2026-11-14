-- BIT Storage · 0005 · row level security
--
-- Roles:  admin      everything
--         accounts   finance + read warehouse
--         warehouse  warehouse operations, no finance
--         customer   read-only view of their own stock, orders and invoices;
--                    may pre-advise goods in and request collections
-- The service role (cron jobs, Stripe webhook) bypasses RLS.

alter table public.company_settings enable row level security;
alter table public.customers enable row level security;
alter table public.profiles enable row level security;
alter table public.email_log enable row level security;
alter table public.integrations enable row level security;     -- no policies: service role only
alter table public.warehouses enable row level security;
alter table public.locations enable row level security;
alter table public.products enable row level security;
alter table public.goods_in enable row level security;
alter table public.goods_in_lines enable row level security;
alter table public.goods_out enable row level security;
alter table public.goods_out_lines enable row level security;
alter table public.pallets enable row level security;
alter table public.stock_movements enable row level security;
alter table public.nominal_accounts enable row level security;
alter table public.tax_codes enable row level security;
alter table public.journals enable row level security;
alter table public.journal_lines enable row level security;
alter table public.expenses enable row level security;
alter table public.charge_types enable row level security;
alter table public.customer_rates enable row level security;
alter table public.billing_runs enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.invoice_line_pallets enable row level security;
alter table public.adhoc_charges enable row level security;
alter table public.payments enable row level security;
alter table public.stripe_events enable row level security;    -- no policies: service role only

-- ---- reference data: any signed-in user may read, admins / finance maintain ----
create policy settings_read on public.company_settings for select to authenticated using (true);
create policy settings_admin on public.company_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy warehouses_read on public.warehouses for select to authenticated using (true);
create policy warehouses_staff on public.warehouses for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy locations_read on public.locations for select to authenticated using (true);
create policy locations_staff on public.locations for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy tax_codes_read on public.tax_codes for select to authenticated using (true);
create policy tax_codes_finance on public.tax_codes for all to authenticated
  using (public.is_finance()) with check (public.is_finance());

create policy charge_types_read on public.charge_types for select to authenticated using (true);
create policy charge_types_finance on public.charge_types for all to authenticated
  using (public.is_finance()) with check (public.is_finance());

-- ---- people ----
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());
-- only admins change roles / customer links (stops anyone promoting themselves)
create policy profiles_admin on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy customers_read on public.customers for select to authenticated
  using (public.is_staff() or id = public.my_customer_id());
create policy customers_finance on public.customers for all to authenticated
  using (public.is_finance()) with check (public.is_finance());

create policy email_log_staff on public.email_log for select to authenticated using (public.is_staff());
create policy email_log_insert on public.email_log for insert to authenticated with check (public.is_staff());

-- ---- warehouse ----
create policy products_read on public.products for select to authenticated
  using (public.is_staff() or customer_id = public.my_customer_id());
create policy products_staff on public.products for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy products_customer_insert on public.products for insert to authenticated
  with check (customer_id = public.my_customer_id());

create policy goods_in_read on public.goods_in for select to authenticated
  using (public.is_staff() or customer_id = public.my_customer_id());
create policy goods_in_staff on public.goods_in for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
-- customers may pre-advise a delivery (status must stay 'expected')
create policy goods_in_customer_insert on public.goods_in for insert to authenticated
  with check (customer_id = public.my_customer_id() and status = 'expected' and source = 'portal'
              and received_at is null and notified_at is null);

create policy goods_in_lines_read on public.goods_in_lines for select to authenticated
  using (public.is_staff() or exists (
    select 1 from public.goods_in g where g.id = goods_in_id and g.customer_id = public.my_customer_id()));
create policy goods_in_lines_staff on public.goods_in_lines for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy goods_in_lines_customer_insert on public.goods_in_lines for insert to authenticated
  with check (exists (
    select 1 from public.goods_in g
     where g.id = goods_in_id and g.customer_id = public.my_customer_id() and g.status = 'expected'));

create policy goods_out_read on public.goods_out for select to authenticated
  using (public.is_staff() or customer_id = public.my_customer_id());
create policy goods_out_staff on public.goods_out for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
-- (customers create collections through request_goods_out(), not by direct insert)

create policy goods_out_lines_read on public.goods_out_lines for select to authenticated
  using (public.is_staff() or exists (
    select 1 from public.goods_out g where g.id = goods_out_id and g.customer_id = public.my_customer_id()));
create policy goods_out_lines_staff on public.goods_out_lines for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy pallets_read on public.pallets for select to authenticated
  using (public.is_staff() or customer_id = public.my_customer_id());
create policy pallets_staff on public.pallets for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy movements_read on public.stock_movements for select to authenticated
  using (public.is_staff() or exists (
    select 1 from public.pallets p where p.id = pallet_id and p.customer_id = public.my_customer_id()));
create policy movements_staff on public.stock_movements for insert to authenticated
  with check (public.is_staff());

-- ---- finance ----
create policy nominal_read on public.nominal_accounts for select to authenticated using (public.is_staff());
create policy nominal_finance on public.nominal_accounts for all to authenticated
  using (public.is_finance()) with check (public.is_finance());

create policy journals_finance on public.journals for all to authenticated
  using (public.is_finance()) with check (public.is_finance());
create policy journal_lines_finance on public.journal_lines for all to authenticated
  using (public.is_finance()) with check (public.is_finance());
create policy expenses_finance on public.expenses for all to authenticated
  using (public.is_finance()) with check (public.is_finance());

create policy customer_rates_read on public.customer_rates for select to authenticated
  using (public.is_finance() or customer_id = public.my_customer_id());
create policy customer_rates_finance on public.customer_rates for all to authenticated
  using (public.is_finance()) with check (public.is_finance());

create policy billing_runs_finance on public.billing_runs for select to authenticated using (public.is_finance());

create policy invoices_read on public.invoices for select to authenticated
  using (public.is_finance() or (customer_id = public.my_customer_id() and status <> 'draft'));
create policy invoices_finance on public.invoices for all to authenticated
  using (public.is_finance()) with check (public.is_finance());

create policy invoice_lines_read on public.invoice_lines for select to authenticated
  using (public.is_finance() or exists (
    select 1 from public.invoices i
     where i.id = invoice_id and i.customer_id = public.my_customer_id() and i.status <> 'draft'));
create policy invoice_lines_finance on public.invoice_lines for all to authenticated
  using (public.is_finance()) with check (public.is_finance());

create policy invoice_line_pallets_read on public.invoice_line_pallets for select to authenticated
  using (public.is_finance() or exists (
    select 1 from public.pallets p where p.id = pallet_id and p.customer_id = public.my_customer_id()));
create policy invoice_line_pallets_finance on public.invoice_line_pallets for all to authenticated
  using (public.is_finance()) with check (public.is_finance());

create policy adhoc_finance on public.adhoc_charges for all to authenticated
  using (public.is_finance()) with check (public.is_finance());

create policy payments_read on public.payments for select to authenticated
  using (public.is_finance() or customer_id = public.my_customer_id());
create policy payments_finance on public.payments for all to authenticated
  using (public.is_finance()) with check (public.is_finance());

-- ---------------------------------------------------------------------------
-- Grants. Nothing for anonymous visitors; RLS above governs signed-in users.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;

grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;

-- Billing runs only from the server (cron job / admin action using the secret key).
revoke execute on function public.run_weekly_billing(date) from authenticated;
revoke execute on function public.bill_customer_week(uuid, date, uuid) from authenticated;
