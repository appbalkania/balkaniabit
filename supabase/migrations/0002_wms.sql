-- BIT Storage · 0002 · warehouse management

create type public.pallet_status as enum ('received', 'stored', 'allocated', 'picked', 'dispatched');
create type public.goods_in_status as enum ('expected', 'received', 'putaway', 'cancelled');
create type public.goods_out_status as enum ('requested', 'allocated', 'picking', 'picked', 'dispatched', 'cancelled');

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  address text
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  code text not null,                       -- e.g. F-A-01-2  (zone-aisle-bay-level)
  zone public.temp_zone not null default 'ambient',
  aisle text,
  bay text,
  level text,
  capacity integer not null default 1 check (capacity > 0),   -- pallets
  is_active boolean not null default true,
  unique (warehouse_id, code)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  sku text not null,
  name text not null,
  temp_zone public.temp_zone not null default 'ambient',
  unit text not null default 'cases',
  units_per_pallet numeric(12, 2),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (customer_id, sku)
);

-- ---------------------------------------------------------------------------
-- Goods in
-- ---------------------------------------------------------------------------
create sequence public.goods_in_no_seq;

create table public.goods_in (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default ('GRN-' || lpad(nextval('public.goods_in_no_seq')::text, 6, '0')),
  customer_id uuid not null references public.customers (id),
  reference text,                           -- customer PO / delivery note
  carrier text,
  expected_date date,
  status public.goods_in_status not null default 'expected',
  source text not null default 'staff' check (source in ('staff', 'portal')),
  notes text,
  received_at timestamptz,
  received_by uuid references auth.users (id),
  notified_at timestamptz,                  -- when the "goods received" email went to the customer
  created_by uuid default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.goods_in_lines (
  id bigint generated always as identity primary key,
  goods_in_id uuid not null references public.goods_in (id) on delete cascade,
  product_id uuid references public.products (id),
  description text not null,
  temp_zone public.temp_zone not null default 'ambient',
  pallets integer not null check (pallets between 1 and 500),
  quantity_per_pallet numeric(12, 2) not null default 0,
  unit text not null default 'cases',
  batch_no text,
  expiry_date date
);

-- ---------------------------------------------------------------------------
-- Goods out
-- ---------------------------------------------------------------------------
create sequence public.goods_out_no_seq;

create table public.goods_out (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default ('GDN-' || lpad(nextval('public.goods_out_no_seq')::text, 6, '0')),
  customer_id uuid not null references public.customers (id),
  reference text,
  requested_date date,
  method text not null default 'collection' check (method in ('collection', 'delivery')),
  delivery_address text,
  collected_by text,                        -- haulier / driver / vehicle reg
  status public.goods_out_status not null default 'requested',
  source text not null default 'staff' check (source in ('staff', 'portal')),
  notes text,
  dispatched_at timestamptz,
  dispatched_by uuid references auth.users (id),
  notified_at timestamptz,                  -- when the "goods collected" email went to the customer
  created_by uuid default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.goods_out_lines (
  id bigint generated always as identity primary key,
  goods_out_id uuid not null references public.goods_out (id) on delete cascade,
  product_id uuid references public.products (id),
  description text not null,
  pallets integer not null check (pallets between 1 and 500)
);

-- ---------------------------------------------------------------------------
-- Pallets: one row per physical pallet
-- ---------------------------------------------------------------------------
create sequence public.pallet_label_seq;

create table public.pallets (
  id uuid primary key default gen_random_uuid(),
  label text not null unique default ('PAL-' || lpad(nextval('public.pallet_label_seq')::text, 7, '0')),
  customer_id uuid not null references public.customers (id),
  product_id uuid references public.products (id),
  description text not null,
  temp_zone public.temp_zone not null default 'ambient',
  quantity numeric(12, 2) not null default 0,
  unit text not null default 'cases',
  batch_no text,
  expiry_date date,
  status public.pallet_status not null default 'received',
  location_id uuid references public.locations (id),
  goods_in_id uuid references public.goods_in (id),
  goods_in_line_id bigint references public.goods_in_lines (id) on delete set null,
  goods_out_id uuid references public.goods_out (id),
  goods_out_line_id bigint references public.goods_out_lines (id) on delete set null,
  received_at timestamptz not null default now(),
  picked_at timestamptz,
  picked_by uuid references auth.users (id),
  dispatched_at timestamptz,
  notes text
);
create index pallets_customer_status_idx on public.pallets (customer_id, status);
create index pallets_location_idx on public.pallets (location_id) where location_id is not null;
create index pallets_expiry_idx on public.pallets (expiry_date) where status <> 'dispatched';
create index pallets_goods_in_idx on public.pallets (goods_in_id);
create index pallets_goods_out_idx on public.pallets (goods_out_id);
create index pallets_billing_idx on public.pallets (customer_id, received_at, dispatched_at);

-- Audit trail of everything that happens to a pallet
create table public.stock_movements (
  id bigint generated always as identity primary key,
  pallet_id uuid not null references public.pallets (id) on delete cascade,
  type text not null check (type in ('receive', 'putaway', 'move', 'allocate', 'deallocate', 'pick', 'dispatch', 'adjust')),
  from_location_id uuid references public.locations (id),
  to_location_id uuid references public.locations (id),
  goods_in_id uuid references public.goods_in (id),
  goods_out_id uuid references public.goods_out (id),
  user_id uuid default auth.uid(),
  note text,
  created_at timestamptz not null default now()
);
create index stock_movements_pallet_idx on public.stock_movements (pallet_id, created_at);

-- ---------------------------------------------------------------------------
-- Goods-in workflow
-- ---------------------------------------------------------------------------

-- Book a delivery in: creates one pallet row (with its own label) per pallet on each line.
create function public.receive_goods_in(p_goods_in uuid, p_received_at timestamptz default now())
returns integer language plpgsql as $$
declare
  g public.goods_in;
  l public.goods_in_lines;
  pid uuid;
  n integer := 0;
begin
  select * into g from public.goods_in where id = p_goods_in for update;
  if not found then raise exception 'Goods-in not found'; end if;
  if g.status <> 'expected' then
    raise exception 'Goods-in % has already been %', g.number, g.status;
  end if;
  if p_received_at > now() + interval '5 minutes' then
    raise exception 'Received date cannot be in the future';
  end if;
  if not exists (select 1 from public.goods_in_lines where goods_in_id = p_goods_in) then
    raise exception 'Add at least one line before receiving';
  end if;

  for l in select * from public.goods_in_lines where goods_in_id = p_goods_in order by id loop
    for i in 1 .. l.pallets loop
      insert into public.pallets (customer_id, product_id, description, temp_zone, quantity, unit,
                                  batch_no, expiry_date, goods_in_id, goods_in_line_id, received_at)
      values (g.customer_id, l.product_id, l.description, l.temp_zone, l.quantity_per_pallet, l.unit,
              l.batch_no, l.expiry_date, p_goods_in, l.id, p_received_at)
      returning id into pid;
      insert into public.stock_movements (pallet_id, type, goods_in_id) values (pid, 'receive', p_goods_in);
      n := n + 1;
    end loop;
  end loop;

  update public.goods_in
     set status = 'received', received_at = p_received_at, received_by = auth.uid()
   where id = p_goods_in;
  return n;
end $$;

-- Put a pallet into a location (or move it). Enforces temperature zone and capacity.
create function public.putaway_pallet(p_pallet uuid, p_location uuid)
returns void language plpgsql as $$
declare
  p public.pallets;
  loc public.locations;
  used integer;
begin
  select * into p from public.pallets where id = p_pallet for update;
  if not found then raise exception 'Pallet not found'; end if;
  if p.status not in ('received', 'stored') then
    raise exception 'Pallet % is % and cannot be moved', p.label, p.status;
  end if;

  -- lock the location row so two people cannot fill the last space at once
  select * into loc from public.locations where id = p_location for update;
  if not found or not loc.is_active then raise exception 'Location not found or inactive'; end if;
  if loc.zone <> p.temp_zone then
    raise exception 'Pallet % is % but location % is %', p.label, p.temp_zone, loc.code, loc.zone;
  end if;

  select count(*) into used from public.pallets
   where location_id = p_location and id <> p_pallet and status in ('stored', 'allocated', 'picked');
  if used >= loc.capacity then
    raise exception 'Location % is full (% of % pallets)', loc.code, used, loc.capacity;
  end if;

  update public.pallets set location_id = p_location, status = 'stored' where id = p_pallet;
  insert into public.stock_movements (pallet_id, type, from_location_id, to_location_id, goods_in_id)
  values (p_pallet, case when p.location_id is null then 'putaway' else 'move' end,
          p.location_id, p_location, p.goods_in_id);

  if p.goods_in_id is not null
     and not exists (select 1 from public.pallets where goods_in_id = p.goods_in_id and status = 'received') then
    update public.goods_in set status = 'putaway' where id = p.goods_in_id and status = 'received';
  end if;
end $$;

-- Put every not-yet-located pallet of a goods-in line into one location.
create function public.putaway_line(p_line bigint, p_location uuid)
returns integer language plpgsql as $$
declare
  r record;
  n integer := 0;
begin
  for r in select id from public.pallets where goods_in_line_id = p_line and status = 'received' order by label loop
    perform public.putaway_pallet(r.id, p_location);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Goods-out workflow
-- ---------------------------------------------------------------------------
create function public.refresh_goods_out_status(p_goods_out uuid)
returns void language plpgsql as $$
declare
  tot integer;
  done integer;
begin
  select count(*), count(*) filter (where status = 'picked') into tot, done
    from public.pallets where goods_out_id = p_goods_out;
  update public.goods_out
     set status = case when tot = 0 then 'requested'
                       when done = 0 then 'allocated'
                       when done < tot then 'picking'
                       else 'picked' end::public.goods_out_status
   where id = p_goods_out and status not in ('dispatched', 'cancelled');
end $$;

-- Allocate stock to an order line by line, FEFO: first-expiring first, then oldest received.
-- Expired pallets are never auto-allocated. Returns the number of pallets it could NOT find.
create function public.allocate_goods_out(p_goods_out uuid)
returns integer language plpgsql as $$
declare
  o public.goods_out;
  l public.goods_out_lines;
  need integer;
  got integer;
  short integer := 0;
begin
  select * into o from public.goods_out where id = p_goods_out for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status in ('dispatched', 'cancelled') then
    raise exception 'Order % is %', o.number, o.status;
  end if;

  for l in select * from public.goods_out_lines where goods_out_id = p_goods_out order by id loop
    select l.pallets - count(*) into need from public.pallets where goods_out_line_id = l.id;
    if need > 0 then
      with candidates as (
        select id from public.pallets
         where customer_id = o.customer_id
           and status = 'stored'
           and ((l.product_id is not null and product_id = l.product_id)
                or (l.product_id is null and lower(description) = lower(l.description)))
           and (expiry_date is null or expiry_date >= public.today())
         order by expiry_date asc nulls last, received_at asc, label asc
         limit need
         for update skip locked
      ), upd as (
        update public.pallets p
           set status = 'allocated', goods_out_id = p_goods_out, goods_out_line_id = l.id
          from candidates c where p.id = c.id
        returning p.id
      )
      insert into public.stock_movements (pallet_id, type, goods_out_id)
      select id, 'allocate', p_goods_out from upd;
      get diagnostics got = row_count;
      short := short + (need - got);
    end if;
  end loop;

  perform public.refresh_goods_out_status(p_goods_out);
  return short;
end $$;

-- Add one specific pallet to an order (staff override of FEFO, e.g. customer asked for a batch).
create function public.allocate_pallet(p_goods_out uuid, p_pallet uuid)
returns void language plpgsql as $$
declare
  o public.goods_out;
  p public.pallets;
begin
  select * into o from public.goods_out where id = p_goods_out for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status in ('dispatched', 'cancelled') then raise exception 'Order % is %', o.number, o.status; end if;
  select * into p from public.pallets where id = p_pallet for update;
  if not found then raise exception 'Pallet not found'; end if;
  if p.customer_id <> o.customer_id then raise exception 'Pallet % belongs to a different customer', p.label; end if;
  if p.status <> 'stored' then raise exception 'Pallet % is % - only stored pallets can be allocated', p.label, p.status; end if;

  update public.pallets set status = 'allocated', goods_out_id = p_goods_out where id = p_pallet;
  insert into public.stock_movements (pallet_id, type, goods_out_id) values (p_pallet, 'allocate', p_goods_out);
  perform public.refresh_goods_out_status(p_goods_out);
end $$;

create function public.deallocate_pallet(p_pallet uuid)
returns void language plpgsql as $$
declare
  p public.pallets;
begin
  select * into p from public.pallets where id = p_pallet for update;
  if not found then raise exception 'Pallet not found'; end if;
  if p.status not in ('allocated', 'picked') then raise exception 'Pallet % is not on an order', p.label; end if;
  update public.pallets
     set status = 'stored', goods_out_id = null, goods_out_line_id = null, picked_at = null, picked_by = null
   where id = p_pallet;
  insert into public.stock_movements (pallet_id, type, goods_out_id) values (p_pallet, 'deallocate', p.goods_out_id);
  perform public.refresh_goods_out_status(p.goods_out_id);
end $$;

-- Picker confirms a pallet has been pulled from its location.
create function public.pick_pallet(p_pallet uuid)
returns void language plpgsql as $$
declare
  p public.pallets;
begin
  select * into p from public.pallets where id = p_pallet for update;
  if not found then raise exception 'Pallet not found'; end if;
  if p.status <> 'allocated' then raise exception 'Pallet % is % - nothing to pick', p.label, p.status; end if;
  update public.pallets set status = 'picked', picked_at = now(), picked_by = auth.uid() where id = p_pallet;
  insert into public.stock_movements (pallet_id, type, from_location_id, goods_out_id)
  values (p_pallet, 'pick', p.location_id, p.goods_out_id);
  perform public.refresh_goods_out_status(p.goods_out_id);
end $$;

-- Pallets leave the building. Storage charging stops from this date.
create function public.dispatch_goods_out(p_goods_out uuid, p_collected_by text default null,
                                          p_dispatched_at timestamptz default now())
returns integer language plpgsql as $$
declare
  o public.goods_out;
  tot integer;
  done integer;
begin
  select * into o from public.goods_out where id = p_goods_out for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status in ('dispatched', 'cancelled') then raise exception 'Order % is already %', o.number, o.status; end if;
  if p_dispatched_at > now() + interval '5 minutes' then raise exception 'Dispatch date cannot be in the future'; end if;

  select count(*), count(*) filter (where status = 'picked') into tot, done
    from public.pallets where goods_out_id = p_goods_out;
  if tot = 0 then raise exception 'Order % has no pallets allocated', o.number; end if;
  if done < tot then raise exception 'Order %: % of % pallets still to be picked', o.number, tot - done, tot; end if;

  insert into public.stock_movements (pallet_id, type, from_location_id, goods_out_id)
  select id, 'dispatch', location_id, p_goods_out from public.pallets where goods_out_id = p_goods_out;

  update public.pallets
     set status = 'dispatched', dispatched_at = p_dispatched_at, location_id = null
   where goods_out_id = p_goods_out;

  update public.goods_out
     set status = 'dispatched', dispatched_at = p_dispatched_at, dispatched_by = auth.uid(),
         collected_by = coalesce(nullif(p_collected_by, ''), collected_by)
   where id = p_goods_out;
  return tot;
end $$;

create function public.cancel_goods_out(p_goods_out uuid)
returns void language plpgsql as $$
declare
  o public.goods_out;
begin
  select * into o from public.goods_out where id = p_goods_out for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status = 'dispatched' then raise exception 'Order % has already been dispatched', o.number; end if;

  insert into public.stock_movements (pallet_id, type, goods_out_id)
  select id, 'deallocate', p_goods_out from public.pallets where goods_out_id = p_goods_out;
  update public.pallets
     set status = 'stored', goods_out_id = null, goods_out_line_id = null, picked_at = null, picked_by = null
   where goods_out_id = p_goods_out;
  update public.goods_out set status = 'cancelled' where id = p_goods_out;
end $$;

-- Customer portal: request release of specific pallets. Runs with elevated rights,
-- so it checks ownership itself.
create function public.request_goods_out(
  p_pallet_ids uuid[], p_reference text, p_requested_date date,
  p_method text, p_delivery_address text, p_notes text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public.my_customer_id();
  oid uuid;
  wanted integer;
  n integer;
begin
  if cid is null then raise exception 'Only customer accounts can request a collection'; end if;
  select count(distinct x) into wanted from unnest(p_pallet_ids) x;
  if coalesce(wanted, 0) = 0 then raise exception 'Select at least one pallet'; end if;

  insert into public.goods_out (customer_id, reference, requested_date, method, delivery_address, notes, source, created_by)
  values (cid, nullif(p_reference, ''), p_requested_date,
          case when p_method = 'delivery' then 'delivery' else 'collection' end,
          nullif(p_delivery_address, ''), nullif(p_notes, ''), 'portal', auth.uid())
  returning id into oid;

  with upd as (
    update public.pallets set status = 'allocated', goods_out_id = oid
     where id = any (p_pallet_ids) and customer_id = cid and status = 'stored'
    returning id
  )
  insert into public.stock_movements (pallet_id, type, goods_out_id, user_id)
  select id, 'allocate', oid, auth.uid() from upd;
  get diagnostics n = row_count;
  if n <> wanted then raise exception 'Some of the selected pallets are no longer available'; end if;

  update public.goods_out set status = 'allocated' where id = oid;
  return oid;
end $$;
