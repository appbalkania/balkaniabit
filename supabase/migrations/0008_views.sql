-- BIT Storage · 0008 · reporting views (security_invoker: the caller's row level security applies)

-- How full each location is
create view public.location_usage with (security_invoker = true) as
select l.id, l.warehouse_id, l.code, l.zone, l.aisle, l.bay, l.level, l.capacity, l.is_active,
       (select count(*) from public.pallets p
         where p.location_id = l.id and p.status in ('stored', 'allocated', 'picked'))::integer as used
  from public.locations l;

-- Stock on hand grouped the way customers think about it: goods / batch / expiry
create view public.stock_summary with (security_invoker = true) as
select p.customer_id, p.description, p.temp_zone, p.batch_no, p.expiry_date, p.unit,
       count(*)::integer as pallets,
       sum(p.quantity) as quantity,
       count(*) filter (where p.status in ('allocated', 'picked'))::integer as pallets_on_order
  from public.pallets p
 where p.status <> 'dispatched'
 group by p.customer_id, p.description, p.temp_zone, p.batch_no, p.expiry_date, p.unit;

-- Money owed per customer
create view public.customer_balances with (security_invoker = true) as
select i.customer_id,
       sum(i.total - i.amount_paid) as outstanding,
       sum(i.total - i.amount_paid) filter (where i.due_date < public.today()) as overdue,
       count(*)::integer as open_invoices
  from public.invoices i
 where i.status in ('issued', 'part_paid')
 group by i.customer_id;

revoke all on public.location_usage, public.stock_summary, public.customer_balances from anon;
grant select on public.location_usage, public.stock_summary, public.customer_balances to authenticated, service_role;
