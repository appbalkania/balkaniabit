// Runs every migration against an in-memory Postgres (PGlite) and exercises the
// warehouse, billing, ledger and row-level-security logic end to end.
//   npm run test:db
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations')
const db = new PGlite()

const q = async (sql, params = []) => (await db.query(sql, params)).rows
const one = async (sql, params = []) => (await q(sql, params))[0]

// run fn as a signed-in Supabase user (role "authenticated", auth.uid() = uid)
async function as(uid, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`)
  }
}
async function asService(fn) {
  await db.exec(`set role service_role;`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role;`)
  }
}

const iso = (d) => d.toISOString().slice(0, 10)
const today = new Date()
const dow = (today.getUTCDay() + 6) % 7 // Monday = 0
const thisMonday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - dow))
const day = (offsetFromLastMonday) => {
  const d = new Date(thisMonday)
  d.setUTCDate(d.getUTCDate() - 7 + offsetFromLastMonday)
  return d
}
const lastMonday = iso(day(0))
const at = (offset) => iso(day(offset)) + 'T12:00:00Z' // midday: same date in UK time all year
const future = (days) => iso(new Date(Date.now() + days * 86400000))

const U = {}
const C = {}
const L = {}

before(async () => {
  // minimal stand-in for the parts of Supabase the migrations rely on
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, service_role;
  `)
  for (const f of readdirSync(dir).sort()) {
    if (f.includes('storage')) continue // needs Supabase's storage schema
    await db.exec(readFileSync(join(dir, f), 'utf8'))
  }

  for (const name of ['admin', 'warehouse', 'accounts', 'custA', 'custB', 'nobody']) {
    U[name] = (await one(`insert into auth.users (email) values ($1) returning id`, [`${name}@test.local`])).id
  }
  C.A = (await one(`insert into customers (account_ref, name, email) values ('ALPHA', 'Alpha Foods', 'a@test.local') returning id`)).id
  C.B = (await one(`insert into customers (account_ref, name, email) values ('BRAVO', 'Bravo Ltd', 'b@test.local') returning id`)).id
  await db.exec(`
    update profiles set role = 'admin' where id = '${U.admin}';
    update profiles set role = 'warehouse' where id = '${U.warehouse}';
    update profiles set role = 'accounts' where id = '${U.accounts}';
    update profiles set customer_id = '${C.A}' where id = '${U.custA}';
    update profiles set customer_id = '${C.B}' where id = '${U.custB}';
    update charge_types set default_rate = 5.00 where code = 'STORAGE_FROZEN';
    update charge_types set default_rate = 4.00 where code = 'STORAGE_CHILLED';
    update charge_types set default_rate = 3.00 where code = 'STORAGE_AMBIENT';
  `)
  const wh = (await one(`select id from warehouses`)).id
  for (const [code, zone, cap] of [['F-A-01', 'frozen', 2], ['F-A-02', 'frozen', 10], ['A-A-01', 'ambient', 10]]) {
    L[code] = (await one(`insert into locations (warehouse_id, code, zone, capacity) values ($1,$2,$3,$4) returning id`, [wh, code, zone, cap])).id
  }
})

test('new sign-ups get no access until an admin grants it', async () => {
  const p = await one(`select role, customer_id from profiles where id = $1`, [U.nobody])
  assert.equal(p.role, 'customer')
  assert.equal(p.customer_id, null)
  const seen = await as(U.nobody, () => q(`select id from customers`))
  assert.equal(seen.length, 0)
})

let grnA
test('goods in: receiving creates one labelled pallet per pallet on each line', async () => {
  await as(U.warehouse, async () => {
    grnA = (await one(`insert into goods_in (customer_id, reference) values ($1, 'PO-1') returning id, number`, [C.A])).id
    await q(
      `insert into goods_in_lines (goods_in_id, description, temp_zone, pallets, quantity_per_pallet, batch_no, expiry_date) values
        ($1, 'Frozen peas', 'frozen', 2, 40, 'B-LATE', $2),
        ($1, 'Frozen peas', 'frozen', 1, 40, 'B-EARLY', $3),
        ($1, 'Frozen peas', 'frozen', 1, 40, 'B-EXPIRED', $4),
        ($1, 'Tinned tomatoes', 'ambient', 2, 100, 'T1', null)`,
      [grnA, future(200), future(20), future(-5)]
    )
    const n = (await one(`select receive_goods_in($1, $2) as n`, [grnA, at(2)])).n // Wednesday last week
    assert.equal(n, 6)
    await assert.rejects(q(`select receive_goods_in($1)`, [grnA]), /already been received/)
  })
  const pallets = await q(`select label, status, location_id from pallets where goods_in_id = $1 order by label`, [grnA])
  assert.equal(pallets.length, 6)
  assert.match(pallets[0].label, /^PAL-\d{7}$/)
  assert.ok(pallets.every((p) => p.status === 'received' && p.location_id === null))
})

test('putaway enforces temperature zone and location capacity, then completes the receipt', async () => {
  await as(U.warehouse, async () => {
    const frozen = await q(`select id from pallets where goods_in_id = $1 and temp_zone = 'frozen' order by label`, [grnA])
    const ambient = await q(`select id from pallets where goods_in_id = $1 and temp_zone = 'ambient' order by label`, [grnA])

    await assert.rejects(q(`select putaway_pallet($1, $2)`, [frozen[0].id, L['A-A-01']]), /is frozen but location A-A-01 is ambient/)
    await q(`select putaway_pallet($1, $2)`, [frozen[0].id, L['F-A-01']])
    await q(`select putaway_pallet($1, $2)`, [frozen[1].id, L['F-A-01']])
    await assert.rejects(q(`select putaway_pallet($1, $2)`, [frozen[2].id, L['F-A-01']]), /is full \(2 of 2 pallets\)/)
    await q(`select putaway_pallet($1, $2)`, [frozen[2].id, L['F-A-02']])
    await q(`select putaway_pallet($1, $2)`, [frozen[3].id, L['F-A-02']])

    assert.equal((await one(`select status from goods_in where id = $1`, [grnA])).status, 'received')
    const line = (await one(`select id from goods_in_lines where goods_in_id = $1 and temp_zone = 'ambient'`, [grnA])).id
    assert.equal((await one(`select putaway_line($1, $2) as n`, [line, L['A-A-01']])).n, 2)
    assert.equal((await one(`select status from goods_in where id = $1`, [grnA])).status, 'putaway')
    assert.equal(ambient.length, 2)
  })
})

let gdnA
test('goods out: FEFO allocation takes earliest expiry first and never expired stock', async () => {
  await as(U.warehouse, async () => {
    gdnA = (await one(`insert into goods_out (customer_id, reference) values ($1, 'REL-1') returning id`, [C.A])).id
    await q(`insert into goods_out_lines (goods_out_id, description, pallets) values ($1, 'frozen peas', 2)`, [gdnA])
    assert.equal((await one(`select allocate_goods_out($1) as short`, [gdnA])).short, 0)
    const got = await q(`select batch_no from pallets where goods_out_id = $1 order by expiry_date`, [gdnA])
    assert.deepEqual(got.map((r) => r.batch_no), ['B-EARLY', 'B-LATE'])
    assert.equal((await one(`select status from goods_out where id = $1`, [gdnA])).status, 'allocated')

    // asking for more than exists reports the shortfall (only 1 unexpired frozen pallet left)
    const o2 = (await one(`insert into goods_out (customer_id) values ($1) returning id`, [C.A])).id
    await q(`insert into goods_out_lines (goods_out_id, description, pallets) values ($1, 'Frozen peas', 3)`, [o2])
    assert.equal((await one(`select allocate_goods_out($1) as short`, [o2])).short, 2)
    await q(`select cancel_goods_out($1)`, [o2])
    assert.equal((await one(`select count(*)::int as n from pallets where goods_out_id = $1`, [o2])).n, 0)
  })
})

test('goods out: must be fully picked before dispatch; dispatch stamps the pallets', async () => {
  await as(U.warehouse, async () => {
    const ps = await q(`select id from pallets where goods_out_id = $1`, [gdnA])
    await q(`select pick_pallet($1)`, [ps[0].id])
    assert.equal((await one(`select status from goods_out where id = $1`, [gdnA])).status, 'picking')
    await assert.rejects(q(`select dispatch_goods_out($1)`, [gdnA]), /1 of 2 pallets still to be picked/)
    await q(`select pick_pallet($1)`, [ps[1].id])
    assert.equal((await one(`select status from goods_out where id = $1`, [gdnA])).status, 'picked')
    // dispatched Friday of last week
    assert.equal((await one(`select dispatch_goods_out($1, 'Driver Dan', $2) as n`, [gdnA, at(4)])).n, 2)
    const out = await q(`select status, location_id, dispatched_at from pallets where goods_out_id = $1`, [gdnA])
    assert.ok(out.every((p) => p.status === 'dispatched' && p.location_id === null && p.dispatched_at))
    const moves = await q(`select type from stock_movements where pallet_id = $1 order by id`, [ps[0].id])
    assert.deepEqual(moves.map((m) => m.type), ['receive', 'putaway', 'allocate', 'pick', 'dispatch'])
  })
})

let invA
test('weekly billing: one line per temperature zone, VAT, gapless number, balanced ledger', async () => {
  // only the server (service role) may run billing
  await as(U.admin, () => assert.rejects(q(`select * from run_weekly_billing()`), /permission denied/))

  const res = await asService(() => q(`select * from run_weekly_billing()`))
  assert.equal(res.length, 1, 'only Alpha has stock')
  invA = res[0].invoice_id

  const inv = await one(`select number, status, period_start::text as period_start, net, vat, total from invoices where id = $1`, [invA])
  assert.equal(inv.number, 'INV-000001')
  assert.equal(inv.status, 'issued')
  assert.equal(inv.period_start, lastMonday)

  const lines = await q(`select charge_type_code, quantity::float as qty, unit_price::float as rate, net::float as net, vat::float as vat, nominal_code from invoice_lines where invoice_id = $1 order by id`, [invA])
  // 4 frozen pallets were in store during the week (2 left on Friday - still a chargeable part-week), 2 ambient
  assert.deepEqual(lines, [
    { charge_type_code: 'STORAGE_FROZEN', qty: 4, rate: 5, net: 20, vat: 4.6, nominal_code: '4000' },
    { charge_type_code: 'STORAGE_AMBIENT', qty: 2, rate: 3, net: 6, vat: 1.38, nominal_code: '4002' },
  ])
  assert.equal(Number(inv.net), 26)
  assert.equal(Number(inv.vat), 5.98) // Irish standard rate 23%
  assert.equal(Number(inv.total), 31.98)
  assert.equal((await one(`select count(*)::int as n from invoice_line_pallets p join invoice_lines l on l.id = p.invoice_line_id where l.invoice_id = $1`, [invA])).n, 6)

  const tb = await q(`select code, debit::float as dr, credit::float as cr from report_trial_balance(null, null)`)
  assert.deepEqual(tb, [
    { code: '1100', dr: 31.98, cr: 0 },
    { code: '2200', dr: 0, cr: 5.98 },
    { code: '4000', dr: 0, cr: 20 },
    { code: '4002', dr: 0, cr: 6 },
  ])

  // running again must not double-bill
  assert.equal((await asService(() => q(`select * from run_weekly_billing()`))).length, 0)
  // and the current (unfinished) week cannot be billed
  await assert.rejects(asService(() => q(`select * from run_weekly_billing($1)`, [iso(thisMonday)])), /has not finished yet/)
})

test('billing: customer price override, void + re-bill in daily pro-rata mode', async () => {
  await as(U.accounts, async () => {
    await q(`select void_invoice($1)`, [invA])
    await q(`insert into customer_rates (customer_id, charge_type_code, rate) values ($1, 'STORAGE_FROZEN', 7.00)`, [C.A])
    await q(`insert into adhoc_charges (customer_id, date, description, quantity, unit_price) values ($1, $2, 'Re-wrap pallet', 2, 2.50)`, [C.A, iso(day(3))])
  })
  await db.exec(`update company_settings set storage_billing_mode = 'daily' where id`)
  const res = await asService(() => q(`select * from run_weekly_billing()`))
  assert.equal(res.length, 1)
  invA = res[0].invoice_id
  const inv = await one(`select number, net::float as net, vat::float as vat from invoices where id = $1`, [invA])
  assert.equal(inv.number, 'INV-000002')
  const lines = await q(`select charge_type_code as code, quantity::float as qty, unit_price::float as rate, net::float as net from invoice_lines where invoice_id = $1 order by id`, [invA])
  // frozen: 2 pallets Wed-Sun (5 days) + 2 pallets Wed-Fri (3 days) = 16 pallet-days = 2.286 weeks @ 7.00
  // ambient: 2 pallets x 5 days = 10 pallet-days = 1.429 weeks @ 3.00
  assert.deepEqual(lines, [
    { code: 'STORAGE_FROZEN', qty: 2.286, rate: 7, net: 16 },
    { code: 'STORAGE_AMBIENT', qty: 1.429, rate: 3, net: 4.29 },
    { code: 'OTHER', qty: 2, rate: 2.5, net: 5 },
  ])
  assert.equal(inv.net, 25.29)
  assert.equal(inv.vat, 5.82) // 3.68 + 0.99 + 1.15
  // voided invoice fully reversed: debtors now equals only the live invoice
  const debtors = await one(`select (debit - credit)::float as bal from report_trial_balance(null, null) where code = '1100'`)
  assert.equal(debtors.bal, 31.11)
  await db.exec(`update company_settings set storage_billing_mode = 'part_week' where id`)
})

test('payments: Stripe webhook retries are idempotent; manual overpayment is refused', async () => {
  await asService(async () => {
    const p1 = (await one(`select record_payment($1, 10.00, 'card', 'pi_1', null, 'pi_1') as id`, [invA])).id
    const p2 = (await one(`select record_payment($1, 10.00, 'card', 'pi_1', null, 'pi_1') as id`, [invA])).id
    assert.equal(p1, p2)
  })
  let inv = await one(`select status, amount_paid::float as paid from invoices where id = $1`, [invA])
  assert.deepEqual(inv, { status: 'part_paid', paid: 10 })
  await as(U.accounts, async () => {
    await assert.rejects(q(`select record_payment($1, 500, 'bank_transfer')`, [invA]), /more than the 21.11 outstanding/)
    await q(`select record_payment($1, 21.11, 'bank_transfer', 'EFT ref 1')`, [invA])
    await assert.rejects(q(`select void_invoice($1)`, [invA]), /Only unpaid issued invoices/)
  })
  inv = await one(`select status, amount_paid::float as paid from invoices where id = $1`, [invA])
  assert.deepEqual(inv, { status: 'paid', paid: 31.11 })
  const tb = await q(`select code, (debit - credit)::float as bal from report_trial_balance(null, null) where code in ('1100', '1200')`)
  assert.deepEqual(tb, [{ code: '1100', bal: 0 }, { code: '1200', bal: 31.11 }])
})

test('expenses post to the ledger; VAT return and P&L add up', async () => {
  await as(U.accounts, async () => {
    await q(`insert into expenses (supplier, description, nominal_code, tax_code, net, vat, paid_from) values ('Power Co', 'Electricity', '7200', 'T1', 10.00, 2.30, 'bank')`)
    await q(`insert into expenses (supplier, description, nominal_code, tax_code, net, vat, paid_from) values ('Agency', 'Wages', '7004', 'T9', 5.00, 0, 'on_credit')`)
    const e = (await one(`insert into expenses (supplier, nominal_code, tax_code, net, vat) values ('Mistake', '7500', 'T1', 99, 22.77) returning id`)).id
    await assert.rejects(q(`update expenses set net = 1 where id = $1`, [e]), /cannot be edited/)
    await q(`delete from expenses where id = $1`, [e])

    const v = await one(`select t1::float as t1, t2::float as t2, t3::float as t3, t4::float as t4, net_sales::float as sales, net_purchases::float as purchases from report_vat_return($1, $2)`, [future(-30), future(1)])
    // Irish VAT3. Sales VAT: the invoice issued and voided in-period nets to zero, leaving the 5.82 on INV-000002
    assert.deepEqual(v, { t1: 5.82, t2: 2.3, t3: 3.52, t4: 0, sales: 25.29, purchases: 10 })

    const tb = await q(`select category, sum(credit - debit)::float as amount from report_trial_balance(null, null) group by category order by category`)
    const by = Object.fromEntries(tb.map((r) => [r.category, r.amount]))
    assert.equal(by.sales, 25.29)
    assert.equal(by.overheads, -15)
    // whole ledger balances
    const all = await one(`select sum(debit - credit)::float as diff from journal_lines`)
    assert.equal(all.diff, 0)
  })
})

test('an unbalanced journal is rejected', async () => {
  await as(U.accounts, async () => {
    const j = (await one(`insert into journals (date, description, source_type) values (current_date, 'bad', 'manual') returning id`)).id
    await assert.rejects(q(`insert into journal_lines (journal_id, nominal_code, debit) values ($1, '1200', 10)`, [j]), /does not balance/)
  })
})

test('row level security: customers see and touch only their own data', async () => {
  // give Bravo a pallet too
  await as(U.warehouse, async () => {
    const g = (await one(`insert into goods_in (customer_id) values ($1) returning id`, [C.B])).id
    await q(`insert into goods_in_lines (goods_in_id, description, temp_zone, pallets) values ($1, 'Bravo stock', 'ambient', 1)`, [g])
    await q(`select receive_goods_in($1)`, [g])
    await q(`select putaway_line((select id from goods_in_lines where goods_in_id = $1), $2)`, [g, L['A-A-01']])
  })
  const bravoPallet = (await one(`select id from pallets where customer_id = $1`, [C.B])).id

  await as(U.custA, async () => {
    const mine = await q(`select distinct customer_id from pallets`)
    assert.deepEqual(mine.map((r) => r.customer_id), [C.A])
    assert.equal((await q(`select id from customers`)).length, 1)
    assert.equal((await q(`select id from invoices`)).length, 2)
    assert.equal((await q(`select id from journals`)).length, 0)
    assert.equal((await q(`select id from expenses`)).length, 0)

    // cannot change stock, promote themselves, or run staff functions
    assert.equal((await db.query(`update pallets set quantity = 0`)).affectedRows, 0)
    assert.equal((await db.query(`update profiles set role = 'admin' where id = $1`, [U.custA])).affectedRows, 0)
    await assert.rejects(q(`select putaway_pallet($1, $2)`, [bravoPallet, L['A-A-01']]), /Pallet not found/)
    await assert.rejects(q(`select record_payment($1, 1, 'cash')`, [invA]), /Invoice not found|row-level security/)

    // may pre-advise a delivery for themselves only
    const g = (await one(`insert into goods_in (customer_id, source, reference) values ($1, 'portal', 'ASN-1') returning id`, [C.A])).id
    await q(`insert into goods_in_lines (goods_in_id, description, pallets) values ($1, 'New stock', 3)`, [g])
    await assert.rejects(q(`insert into goods_in (customer_id, source) values ($1, 'portal')`, [C.B]), /row-level security/)
    await assert.rejects(q(`insert into goods_in (customer_id, source, status) values ($1, 'portal', 'putaway')`, [C.A]), /row-level security/)

    // may request collection of their own stored pallets, not anyone else's
    await assert.rejects(q(`select request_goods_out($1::uuid[], 'x', null, 'collection', null, null)`, [[bravoPallet]]), /no longer available/)
    const own = await q(`select id from pallets where status = 'stored' and temp_zone = 'ambient'`)
    const oid = (await one(`select request_goods_out($1::uuid[], 'MY-REF', null, 'collection', null, 'please') as id`, [own.map((p) => p.id)])).id
    const o = await one(`select status, source, customer_id from goods_out where id = $1`, [oid])
    assert.deepEqual(o, { status: 'allocated', source: 'portal', customer_id: C.A })
  })
  assert.equal((await one(`select status from pallets where id = $1`, [bravoPallet])).status, 'stored')

  // warehouse staff run the floor but cannot see the money
  await as(U.warehouse, async () => {
    assert.equal((await q(`select id from invoices`)).length, 0)
    assert.equal((await q(`select id from journal_lines`)).length, 0)
    assert.ok((await q(`select id from pallets`)).length >= 7)
  })
})
