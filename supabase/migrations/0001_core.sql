-- BIT Storage · 0001 · core: settings, users, customers
-- Run migrations in order (Supabase SQL editor or `supabase db push`).

create type public.user_role as enum ('admin', 'accounts', 'warehouse', 'customer');
create type public.temp_zone as enum ('frozen', 'chilled', 'ambient');

-- All "which day did this happen" logic uses Irish local time.
create function public.local_date(ts timestamptz) returns date
language sql stable as $$ select (ts at time zone 'Europe/Dublin')::date $$;

create function public.today() returns date
language sql stable as $$ select (now() at time zone 'Europe/Dublin')::date $$;

-- ---------------------------------------------------------------------------
-- Company settings (single row)
-- ---------------------------------------------------------------------------
create table public.company_settings (
  id boolean primary key default true check (id),
  company_name text not null default 'BIT Storage',
  tagline text default 'Part of Balkania Group',  -- printed under the name on invoices and emails
  legal_name text,
  address text,
  phone text,
  email text,
  vat_number text,
  company_number text,                     -- CRO number
  bank_details text,                       -- printed on invoices for bank transfer
  invoice_prefix text not null default 'INV-',
  next_invoice_no integer not null default 1,   -- gapless counter
  default_payment_terms_days integer not null default 7,
  default_tax_code text not null default 'T1',
  -- 'part_week': a pallet in store for any part of the week is charged a full week
  -- 'daily':     charged pro-rata, days in store / 7
  storage_billing_mode text not null default 'part_week'
    check (storage_billing_mode in ('part_week', 'daily')),
  expiry_alert_days integer not null default 30,
  -- Sage control accounts
  nominal_debtors text not null default '1100',
  nominal_bank text not null default '1200',
  nominal_cash text not null default '1230',
  nominal_credit_card text not null default '1240',
  nominal_creditors text not null default '2100',
  nominal_sales_vat text not null default '2200',
  nominal_purchase_vat text not null default '2201',
  sage_mode text not null default 'none' check (sage_mode in ('none', 'sage50_csv', 'sage_accounting'))
);
-- BIT Storage's own details (all editable later in Admin > Settings). Phone to be added.
insert into public.company_settings (id, address, vat_number)
values (true,
        E'Sanguine House\nHuntstown Business Park\nCappagh Road\nDublin 11\nD11 T9TF, Ireland',
        'IE4281815IH');

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  account_ref text not null unique check (account_ref = upper(account_ref) and length(account_ref) between 1 and 8),
  name text not null,
  contact_name text,
  email text,                              -- invoices + stock notifications go here
  phone text,
  address text,
  postcode text,
  vat_number text,
  tax_code text not null default 'T1',
  payment_terms_days integer not null default 7,
  payment_method text not null default 'bank_transfer'
    check (payment_method in ('bank_transfer', 'card', 'sepa_debit', 'bacs_debit')),
  auto_charge boolean not null default true,     -- charge saved card / Direct Debit when invoice is issued
  stripe_customer_id text unique,
  stripe_payment_method_id text,
  stripe_payment_method_label text,
  stripe_mandate_id text,                        -- Direct Debit mandate (SEPA, or Bacs if trading in GBP)
  sage_contact_id text,
  expiry_alert_days integer,                     -- null = company default
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Profiles (one per auth user)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  role public.user_role not null default 'customer',
  customer_id uuid references public.customers (id) on delete set null,
  created_at timestamptz not null default now()
);

-- New sign-ups get a profile with NO access (customer role, no customer linked).
-- An admin grants a role / links a customer from the Users screen.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Role helpers used by row level security.
create function public.my_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin', 'accounts', 'warehouse') from public.profiles where id = auth.uid()), false)
$$;

create function public.is_finance() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin', 'accounts') from public.profiles where id = auth.uid()), false)
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false)
$$;

create function public.my_customer_id() returns uuid
language sql stable security definer set search_path = public as $$
  select customer_id from public.profiles where id = auth.uid() and role = 'customer'
$$;

-- Outbound email audit trail
create table public.email_log (
  id bigint generated always as identity primary key,
  kind text not null,                      -- invoice | goods_in | goods_out | expiry | payment_failed
  recipient text,
  subject text,
  customer_id uuid references public.customers (id) on delete set null,
  related_id uuid,
  status text not null,                    -- sent | skipped | failed
  error text,
  created_at timestamptz not null default now()
);

-- OAuth tokens for integrations (Sage). No RLS policies: service role only.
create table public.integrations (
  provider text primary key,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  meta jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
