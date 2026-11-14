-- BIT Storage · 0004 · rates, weekly billing, invoices, payments, VAT return

-- ---------------------------------------------------------------------------
-- Charge types. The three weekly storage charges are Frozen / Chilled / Ambient.
-- ---------------------------------------------------------------------------
create table public.charge_types (
  code text primary key,
  name text not null,
  basis text not null check (basis in ('storage_week', 'per_pallet_in', 'per_pallet_out', 'adhoc')),
  temp_zone public.temp_zone,               -- set for storage_week charges
  default_rate numeric(10, 2) not null default 0 check (default_rate >= 0),
  nominal_code text not null references public.nominal_accounts (code),
  is_active boolean not null default true,
  sort integer not null default 0,
  check ((basis = 'storage_week') = (temp_zone is not null))
);
create unique index charge_types_zone_idx on public.charge_types (temp_zone) where basis = 'storage_week';

-- Per-customer price overrides
create table public.customer_rates (
  customer_id uuid not null references public.customers (id) on delete cascade,
  charge_type_code text not null references public.charge_types (code) on delete cascade,
  rate numeric(10, 2) not null check (rate >= 0),
  primary key (customer_id, charge_type_code)
);

create function public.rate_for(p_customer uuid, p_code text) returns numeric
language sql stable as $$
  select coalesce(
    (select rate from public.customer_rates where customer_id = p_customer and charge_type_code = p_code),
    (select default_rate from public.charge_types where code = p_code),
    0)
$$;

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------
create type public.invoice_status as enum ('draft', 'issued', 'part_paid', 'paid', 'void');

create table public.billing_runs (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique,
  week_end date not null,
  last_run_at timestamptz not null default now()
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  number text unique,                       -- assigned when issued (gapless)
  customer_id uuid not null references public.customers (id),
  kind text not null default 'weekly' check (kind in ('weekly', 'manual')),
  period_start date,
  period_end date,
  issue_date date not null default public.today(),
  due_date date not null default public.today(),
  status public.invoice_status not null default 'draft',
  net numeric(12, 2) not null default 0,
  vat numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  amount_paid numeric(12, 2) not null default 0,
  paid_at timestamptz,
  voided_at date,
  journal_id uuid references public.journals (id),
  billing_run_id uuid references public.billing_runs (id),
  -- delivery
  emailed_at timestamptz,
  email_error text,
  -- automatic collection (Stripe card / SEPA Direct Debit)
  stripe_payment_intent_id text,
  payment_status text check (payment_status in ('processing', 'succeeded', 'failed')),
  payment_error text,
  charge_attempts integer not null default 0,
  -- Sage
  sage_id text,
  sage_synced_at timestamptz,
  sage_error text,
  created_at timestamptz not null default now()
);
create unique index invoices_weekly_once_idx on public.invoices (customer_id, period_start)
  where kind = 'weekly' and status <> 'void';
create index invoices_customer_idx on public.invoices (customer_id, issue_date desc);

create table public.invoice_lines (
  id bigint generated always as identity primary key,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  charge_type_code text references public.charge_types (code),
  description text not null,
  quantity numeric(12, 3) not null,
  unit_price numeric(10, 2) not null,
  net numeric(12, 2) not null,
  tax_code text not null references public.tax_codes (code),
  vat_rate numeric(6, 4) not null,
  vat numeric(12, 2) not null,
  nominal_code text not null references public.nominal_accounts (code)
);
create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id);

-- Which pallets a storage line was charged for (backing detail for queries / disputes)
create table public.invoice_line_pallets (
  invoice_line_id bigint not null references public.invoice_lines (id) on delete cascade,
  pallet_id uuid not null references public.pallets (id),
  days integer not null,
  primary key (invoice_line_id, pallet_id)
);

-- One-off charges (re-wrap, labelling, overtime...) picked up by the next weekly invoice
create table public.adhoc_charges (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id),
  date date not null default public.today(),
  charge_type_code text not null default 'OTHER' references public.charge_types (code),
  description text not null,
  quantity numeric(12, 3) not null default 1 check (quantity > 0),
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  invoice_line_id bigint references public.invoice_lines (id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id),
  customer_id uuid not null references public.customers (id),
  date date not null default public.today(),
  amount numeric(12, 2) not null check (amount > 0),
  method text not null check (method in ('card', 'sepa_debit', 'bacs_debit', 'bank_transfer', 'cash', 'other')),
  reference text,
  stripe_payment_intent_id text unique,
  journal_id uuid references public.journals (id),
  sage_synced_at timestamptz,
  created_at timestamptz not null default now()
);
create index payments_invoice_idx on public.payments (invoice_id);

-- Stripe webhook de-duplication
create table public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Weekly billing
-- ---------------------------------------------------------------------------

-- Pallets of one temperature zone that were in store at any point in [p_from, p_to],
-- with the number of days in that window (receipt day and dispatch day both count).
create function public.pallets_in_store(p_customer uuid, p_zone public.temp_zone, p_from date, p_to date)
returns table (pallet_id uuid, days integer)
language sql stable as $$
  select id,
         (least(p_to, coalesce(public.local_date(dispatched_at), p_to))
          - greatest(p_from, public.local_date(received_at)) + 1)::integer
    from public.pallets
   where customer_id = p_customer
     and temp_zone = p_zone
     and public.local_date(received_at) <= p_to
     and (dispatched_at is null or public.local_date(dispatched_at) >= p_from)
$$;

-- Build and issue one customer's invoice for one Monday-Sunday week.
-- Returns the invoice id, or null if already billed / nothing to charge.
create function public.bill_customer_week(p_customer uuid, p_week_start date, p_run uuid default null)
returns uuid language plpgsql as $$
declare
  s public.company_settings;
  c public.customers;
  ct public.charge_types;
  a public.adhoc_charges;
  week_end date := p_week_start + 6;
  wc text := to_char(p_week_start, 'DD Mon YYYY');
  tax_rate numeric;
  rate numeric;
  n integer;
  total_days integer;
  qty numeric;
  v_net numeric;
  line_id bigint;
  inv uuid;
  jid uuid;
  inv_no text;
  v_total_net numeric;
  v_total_vat numeric;
begin
  if extract(isodow from p_week_start) <> 1 then
    raise exception 'Billing weeks start on a Monday (% is not)', p_week_start;
  end if;
  if week_end >= public.today() then
    raise exception 'Week commencing % has not finished yet', p_week_start;
  end if;

  -- locking the settings row serialises invoice numbering
  select * into s from public.company_settings for update;
  select * into c from public.customers where id = p_customer;
  if not found then raise exception 'Customer not found'; end if;

  if exists (select 1 from public.invoices
              where customer_id = p_customer and kind = 'weekly'
                and period_start = p_week_start and status <> 'void') then
    return null;
  end if;

  select t.rate into tax_rate from public.tax_codes t where t.code = c.tax_code;
  if tax_rate is null then raise exception 'Customer % has unknown tax code %', c.account_ref, c.tax_code; end if;

  insert into public.invoices (customer_id, kind, period_start, period_end, issue_date, due_date, status, billing_run_id)
  values (p_customer, 'weekly', p_week_start, week_end, public.today(),
          public.today() + c.payment_terms_days, 'draft', p_run)
  returning id into inv;

  -- 1. weekly storage, one line per temperature zone
  for ct in select * from public.charge_types where is_active and basis = 'storage_week' order by sort, code loop
    rate := public.rate_for(p_customer, ct.code);
    select count(*), coalesce(sum(days), 0) into n, total_days
      from public.pallets_in_store(p_customer, ct.temp_zone, p_week_start, week_end);
    if n > 0 and rate > 0 then
      if s.storage_billing_mode = 'daily' then
        qty := round(total_days / 7.0, 3);
      else
        qty := n;
      end if;
      v_net := round(qty * rate, 2);
      insert into public.invoice_lines (invoice_id, charge_type_code, description, quantity, unit_price, net,
                                        tax_code, vat_rate, vat, nominal_code)
      values (inv, ct.code,
              ct.name || ', w/c ' || wc || ' - ' || n || ' pallet' || case when n = 1 then '' else 's' end
                || case when s.storage_billing_mode = 'daily' then ' (' || total_days || ' pallet-days)' else '' end,
              qty, rate, v_net, c.tax_code, tax_rate, round(v_net * tax_rate, 2), ct.nominal_code)
      returning id into line_id;
      insert into public.invoice_line_pallets (invoice_line_id, pallet_id, days)
      select line_id, pallet_id, days
        from public.pallets_in_store(p_customer, ct.temp_zone, p_week_start, week_end);
    end if;
  end loop;

  -- 2. handling charges per pallet received / dispatched in the week (skipped while the rate is 0)
  for ct in select * from public.charge_types
             where is_active and basis in ('per_pallet_in', 'per_pallet_out') order by sort, code loop
    rate := public.rate_for(p_customer, ct.code);
    if ct.basis = 'per_pallet_in' then
      select count(*) into n from public.pallets
       where customer_id = p_customer and public.local_date(received_at) between p_week_start and week_end;
    else
      select count(*) into n from public.pallets
       where customer_id = p_customer and dispatched_at is not null
         and public.local_date(dispatched_at) between p_week_start and week_end;
    end if;
    if n > 0 and rate > 0 then
      v_net := round(n * rate, 2);
      insert into public.invoice_lines (invoice_id, charge_type_code, description, quantity, unit_price, net,
                                        tax_code, vat_rate, vat, nominal_code)
      values (inv, ct.code, ct.name || ', w/c ' || wc, n, rate, v_net,
              c.tax_code, tax_rate, round(v_net * tax_rate, 2), ct.nominal_code);
    end if;
  end loop;

  -- 3. one-off charges not yet invoiced
  for a in select * from public.adhoc_charges
            where customer_id = p_customer and invoice_line_id is null and date <= week_end
            order by date, created_at
            for update loop
    v_net := round(a.quantity * a.unit_price, 2);
    if v_net > 0 then
      insert into public.invoice_lines (invoice_id, charge_type_code, description, quantity, unit_price, net,
                                        tax_code, vat_rate, vat, nominal_code)
      select inv, a.charge_type_code, a.description || ' (' || to_char(a.date, 'DD Mon') || ')',
             a.quantity, a.unit_price, v_net, c.tax_code, tax_rate, round(v_net * tax_rate, 2), t.nominal_code
        from public.charge_types t where t.code = a.charge_type_code
      returning id into line_id;
      update public.adhoc_charges set invoice_line_id = line_id where id = a.id;
    end if;
  end loop;

  select coalesce(sum(net), 0), coalesce(sum(vat), 0) into v_total_net, v_total_vat
    from public.invoice_lines where invoice_id = inv;
  if v_total_net = 0 then
    delete from public.invoices where id = inv;   -- nothing to charge this week
    return null;
  end if;

  -- issue: gapless number + ledger posting
  inv_no := s.invoice_prefix || lpad(s.next_invoice_no::text, 6, '0');
  update public.company_settings set next_invoice_no = next_invoice_no + 1 where id;

  insert into public.journals (date, description, source_type, source_id)
  values (public.today(), 'Invoice ' || inv_no || ' - ' || c.name, 'invoice', inv)
  returning id into jid;
  insert into public.journal_lines (journal_id, nominal_code, debit, description)
  values (jid, s.nominal_debtors, v_total_net + v_total_vat, c.account_ref);
  insert into public.journal_lines (journal_id, nominal_code, credit, description)
  select jid, nominal_code, sum(net), inv_no from public.invoice_lines where invoice_id = inv group by nominal_code;
  if v_total_vat > 0 then
    insert into public.journal_lines (journal_id, nominal_code, credit, description)
    values (jid, s.nominal_sales_vat, v_total_vat, 'VAT ' || c.tax_code);
  end if;

  update public.invoices
     set number = inv_no, status = 'issued', net = v_total_net, vat = v_total_vat,
         total = v_total_net + v_total_vat, journal_id = jid
   where id = inv;
  return inv;
end $$;

-- Bill every active customer for a week (default: the week that has just finished).
-- Safe to run more than once: customers already invoiced for the week are skipped.
create function public.run_weekly_billing(p_week_start date default null)
returns table (invoice_id uuid, customer_id uuid)
language plpgsql as $$
declare
  ws date := coalesce(p_week_start,
                      public.today() - (extract(isodow from public.today())::integer - 1) - 7);
  run uuid;
  c record;
  inv uuid;
begin
  if extract(isodow from ws) <> 1 then
    raise exception 'Billing weeks start on a Monday (% is not)', ws;
  end if;
  insert into public.billing_runs (week_start, week_end) values (ws, ws + 6)
  on conflict (week_start) do update set last_run_at = now()
  returning id into run;

  for c in select id from public.customers where is_active order by account_ref loop
    inv := public.bill_customer_week(c.id, ws, run);
    if inv is not null then
      invoice_id := inv;
      customer_id := c.id;
      return next;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------

-- Record money received against an invoice and post Dr bank / Cr debtors.
-- Idempotent per Stripe PaymentIntent, so webhook retries are harmless.
create function public.record_payment(
  p_invoice uuid, p_amount numeric, p_method text,
  p_reference text default null, p_date date default null, p_stripe_pi text default null)
returns uuid language plpgsql as $$
declare
  i public.invoices;
  s public.company_settings;
  pid uuid;
  jid uuid;
  d date := coalesce(p_date, public.today());
begin
  select * into i from public.invoices where id = p_invoice for update;
  if not found then raise exception 'Invoice not found'; end if;

  if p_stripe_pi is not null then
    select id into pid from public.payments where stripe_payment_intent_id = p_stripe_pi;
    if found then return pid; end if;
  end if;

  if i.status in ('draft', 'void') then raise exception 'Invoice % is % - cannot take payment', i.number, i.status; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Payment amount must be positive'; end if;
  -- manual entries may not overpay; money Stripe has already taken is always recorded
  if p_stripe_pi is null and p_amount > i.total - i.amount_paid then
    raise exception 'Payment of % is more than the % outstanding on %', p_amount, i.total - i.amount_paid, i.number;
  end if;

  select * into s from public.company_settings;
  insert into public.journals (date, description, source_type)
  values (d, 'Payment received - ' || i.number, 'payment')
  returning id into jid;
  insert into public.journal_lines (journal_id, nominal_code, debit, description)
  values (jid, s.nominal_bank, p_amount, coalesce(p_reference, p_method));
  insert into public.journal_lines (journal_id, nominal_code, credit, description)
  values (jid, s.nominal_debtors, p_amount, i.number);

  insert into public.payments (invoice_id, customer_id, date, amount, method, reference, stripe_payment_intent_id, journal_id)
  values (p_invoice, i.customer_id, d, p_amount, p_method, p_reference, p_stripe_pi, jid)
  returning id into pid;
  update public.journals set source_id = pid where id = jid;

  update public.invoices
     set amount_paid = amount_paid + p_amount,
         status = case when amount_paid + p_amount >= total then 'paid' else 'part_paid' end::public.invoice_status,
         paid_at = case when amount_paid + p_amount >= total then now() else paid_at end,
         payment_status = case when p_stripe_pi is not null then 'succeeded' else payment_status end,
         payment_error = null
   where id = p_invoice;
  return pid;
end $$;

-- Cancel an unpaid invoice: reverses its ledger posting and frees the week to be re-billed.
create function public.void_invoice(p_invoice uuid)
returns void language plpgsql as $$
declare
  i public.invoices;
  jid uuid;
begin
  select * into i from public.invoices where id = p_invoice for update;
  if not found then raise exception 'Invoice not found'; end if;
  if i.status <> 'issued' or i.amount_paid > 0 then
    raise exception 'Only unpaid issued invoices can be voided (% is %)', i.number, i.status;
  end if;
  if i.payment_status = 'processing' then
    raise exception 'A payment for % is in progress - wait for it to settle', i.number;
  end if;

  insert into public.journals (date, description, source_type, source_id)
  values (public.today(), 'VOID invoice ' || i.number, 'invoice_void', p_invoice)
  returning id into jid;
  insert into public.journal_lines (journal_id, nominal_code, debit, credit, description)
  select jid, nominal_code, credit, debit, 'Reversal ' || i.number
    from public.journal_lines where journal_id = i.journal_id;

  update public.adhoc_charges set invoice_line_id = null
   where invoice_line_id in (select id from public.invoice_lines where invoice_id = p_invoice);
  update public.invoices set status = 'void', voided_at = public.today() where id = p_invoice;
end $$;

-- ---------------------------------------------------------------------------
-- Irish VAT3 return figures (invoice basis). Tax point = invoice date.
--   T1 VAT on sales   T2 VAT on purchases   T3 payable (T1 > T2)   T4 repayable (T2 > T1)
--   E1 / E2 intra-EU goods and ES1 / ES2 intra-EU services are 0: this system only records
--   domestic storage sales and domestic expenses. Enter any EU trade on ROS by hand.
--   net_sales / net_purchases are supporting totals (ex VAT) for the annual Return of Trading Details.
-- ---------------------------------------------------------------------------
create function public.report_vat_return(p_from date, p_to date)
returns table (t1 numeric, t2 numeric, t3 numeric, t4 numeric,
               e1 numeric, e2 numeric, es1 numeric, es2 numeric,
               net_sales numeric, net_purchases numeric)
language sql stable as $$
  with sales as (
    select
      coalesce(sum(l.vat) filter (where i.issue_date between p_from and p_to), 0)
        - coalesce(sum(l.vat) filter (where i.voided_at between p_from and p_to), 0) as vat,
      coalesce(sum(l.net) filter (where i.issue_date between p_from and p_to and t.in_vat_return), 0)
        - coalesce(sum(l.net) filter (where i.voided_at between p_from and p_to and t.in_vat_return), 0) as net
      from public.invoice_lines l
      join public.invoices i on i.id = l.invoice_id and i.status <> 'draft'
      join public.tax_codes t on t.code = l.tax_code
  ), purchases as (
    select coalesce(sum(e.vat), 0) as vat,
           coalesce(sum(e.net) filter (where t.in_vat_return), 0) as net
      from public.expenses e
      join public.tax_codes t on t.code = e.tax_code
     where e.date between p_from and p_to
  )
  select s.vat, p.vat, greatest(s.vat - p.vat, 0), greatest(p.vat - s.vat, 0),
         0::numeric, 0::numeric, 0::numeric, 0::numeric,
         s.net, p.net
    from sales s, purchases p
$$;
