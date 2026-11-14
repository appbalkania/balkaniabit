-- BIT Storage · 0003 · double-entry ledger on Sage nominal codes, expenses, reports

create table public.nominal_accounts (
  code text primary key check (code ~ '^[0-9]{4,8}$'),
  name text not null,
  category text not null check (category in (
    'fixed_assets', 'current_assets', 'current_liabilities', 'long_term_liabilities',
    'capital_reserves', 'sales', 'purchases', 'direct_expenses', 'overheads')),
  is_active boolean not null default true
);

-- Sage tax codes
create table public.tax_codes (
  code text primary key,
  description text not null,
  rate numeric(6, 4) not null default 0,       -- 0.2000 = 20%
  in_vat_return boolean not null default true  -- false for T9 (outside the scope of VAT)
);

create table public.journals (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  description text not null,
  source_type text not null check (source_type in ('invoice', 'invoice_void', 'payment', 'expense', 'manual')),
  source_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index journals_date_idx on public.journals (date);
create index journals_source_idx on public.journals (source_type, source_id);

create table public.journal_lines (
  id bigint generated always as identity primary key,
  journal_id uuid not null references public.journals (id) on delete cascade,
  nominal_code text not null references public.nominal_accounts (code),
  debit numeric(14, 2) not null default 0 check (debit >= 0),
  credit numeric(14, 2) not null default 0 check (credit >= 0),
  description text,
  check (not (debit > 0 and credit > 0))
);
create index journal_lines_journal_idx on public.journal_lines (journal_id);
create index journal_lines_nominal_idx on public.journal_lines (nominal_code);

-- Every journal must balance. Checked at commit so lines can be inserted one by one.
create function public.check_journal_balanced() returns trigger
language plpgsql as $$
declare
  jid uuid := coalesce(new.journal_id, old.journal_id);
  diff numeric;
begin
  select coalesce(sum(debit), 0) - coalesce(sum(credit), 0) into diff
    from public.journal_lines where journal_id = jid;
  if diff <> 0 then
    raise exception 'Journal % does not balance (out by %)', jid, diff;
  end if;
  return null;
end $$;

create constraint trigger journal_lines_balanced
  after insert or update or delete on public.journal_lines
  deferrable initially deferred
  for each row execute function public.check_journal_balanced();

-- ---------------------------------------------------------------------------
-- Expenses (purchase side). Inserting a row posts the journal automatically:
--   Dr expense nominal (net)  Dr 2201 purchase VAT  Cr bank / cash / card / creditors (gross)
-- ---------------------------------------------------------------------------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  date date not null default public.today(),
  supplier text not null,
  reference text,
  description text,
  nominal_code text not null references public.nominal_accounts (code),
  tax_code text not null default 'T1' references public.tax_codes (code),
  net numeric(12, 2) not null check (net > 0),
  vat numeric(12, 2) not null default 0 check (vat >= 0),
  gross numeric(12, 2) generated always as (net + vat) stored,
  paid_from text not null default 'bank' check (paid_from in ('bank', 'cash', 'credit_card', 'on_credit')),
  receipt_path text,                         -- file in the "receipts" storage bucket
  journal_id uuid references public.journals (id) on delete set null,
  sage_synced_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index expenses_date_idx on public.expenses (date);

create function public.post_expense() returns trigger
language plpgsql as $$
declare
  s public.company_settings;
  jid uuid;
  contra text;
begin
  select * into s from public.company_settings;
  contra := case new.paid_from
              when 'bank' then s.nominal_bank
              when 'cash' then s.nominal_cash
              when 'credit_card' then s.nominal_credit_card
              else s.nominal_creditors end;

  insert into public.journals (date, description, source_type, source_id)
  values (new.date, 'Expense: ' || new.supplier || coalesce(' - ' || new.description, ''), 'expense', new.id)
  returning id into jid;

  insert into public.journal_lines (journal_id, nominal_code, debit, description)
  values (jid, new.nominal_code, new.net, new.supplier);
  if new.vat > 0 then
    insert into public.journal_lines (journal_id, nominal_code, debit, description)
    values (jid, s.nominal_purchase_vat, new.vat, 'VAT ' || new.tax_code);
  end if;
  insert into public.journal_lines (journal_id, nominal_code, credit, description)
  values (jid, contra, new.net + new.vat, new.supplier);

  new.journal_id := jid;
  return new;
end $$;

create trigger expenses_post before insert on public.expenses
  for each row execute function public.post_expense();

-- Deleting an expense removes its journal (corrections = delete and re-enter).
create function public.unpost_expense() returns trigger
language plpgsql as $$
begin
  if old.journal_id is not null then
    delete from public.journals where id = old.journal_id;
  end if;
  return old;
end $$;

create trigger expenses_unpost after delete on public.expenses
  for each row execute function public.unpost_expense();

-- The money columns of an expense are locked once posted.
create function public.lock_expense() returns trigger
language plpgsql as $$
begin
  if (new.net, new.vat, new.nominal_code, new.paid_from, new.date)
     is distinct from (old.net, old.vat, old.nominal_code, old.paid_from, old.date) then
    raise exception 'Posted expenses cannot be edited - delete and re-enter instead';
  end if;
  return new;
end $$;

create trigger expenses_lock before update on public.expenses
  for each row execute function public.lock_expense();

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

-- Movement per nominal between two dates (either end may be null = open ended).
-- security_invoker default: staff RLS on journals applies.
create function public.report_trial_balance(p_from date, p_to date)
returns table (code text, name text, category text, debit numeric, credit numeric)
language sql stable as $$
  select n.code, n.name, n.category,
         coalesce(sum(l.debit), 0)::numeric, coalesce(sum(l.credit), 0)::numeric
    from public.nominal_accounts n
    join public.journal_lines l on l.nominal_code = n.code
    join public.journals j on j.id = l.journal_id
   where (p_from is null or j.date >= p_from)
     and (p_to is null or j.date <= p_to)
   group by n.code, n.name, n.category
  having coalesce(sum(l.debit), 0) <> 0 or coalesce(sum(l.credit), 0) <> 0
   order by n.code
$$;
