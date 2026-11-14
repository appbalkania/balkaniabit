# BIT Storage platform

Pallet storage management for BIT Storage (part of Balkania Group), Ireland.
Next.js on **Vercel**, database and logins on **Supabase**, payments on **Stripe**, accounts export to **Sage**.

| Area | What it does |
|---|---|
| **Warehouse (WMS)** | Goods in → receive → one QR pallet label per pallet → putaway to a location (frozen/chilled/ambient zones enforced, capacity enforced). Goods out → automatic FEFO allocation (earliest expiry first, never expired stock) → picker screen with scan-to-pick → dispatch. Stock search, pallet history, expiry report, location capacity. |
| **Customer emails (automatic)** | **Goods received**: sent when the last pallet of a delivery is put away. Lists goods, number of pallets, batch, **expiry date** and **location**. **Goods collected**: sent on dispatch. Lists the pallets that left (with expiry) **and everything still in the warehouse** (with expiry and quantities). **Expiry notice**: every Monday, to customers with stock expired or expiring soon. **Invoice**: PDF attached, every Monday. |
| **Billing** | Every Monday 06:00 the previous Mon–Sun week is invoiced: up to **3 storage charges** (Frozen / Chilled / Ambient, per pallet per week), plus optional handling in/out and one-off charges. Per-customer prices. Part-week-as-full-week or daily pro-rata. Gapless invoice numbers. |
| **Payments** | Customers set up **SEPA Direct Debit** or a **card** in the portal (Stripe-hosted). Each invoice is then collected automatically. Failed payments email the customer and staff. Bank transfers are recorded by hand. |
| **Accounts** | Double-entry ledger on **Sage nominal codes**. Expenses with receipt photos. **Profit & loss**, **balance sheet**, **VAT3 return** (T1–T4), manual journals (opening balances, wages…). |
| **Sage** | Sage 50 (desktop): CSV for *File › Import › Audit Trail Transactions*. Sage Accounting (cloud): live connection that pushes invoices and receipts nightly. |
| **Customer portal** | Stock by product with expiry dates and locations, pre-advise deliveries, request collections by ticking pallets, invoices with PDF and pay-by-card, payment details. |
| **Website** | Public landing page at `/` (photos in `public/landing/`, contact details read from Admin › Settings). **Client login** goes to `/login`; after sign-in `/dashboard` sends staff to `/admin` and customers to `/portal`. |
| **Roles** | `admin` (everything), `accounts` (money + warehouse), `warehouse` (no money), `customer` (own data only, enforced in the database). |

---

## 1. Supabase

1. Create a project at supabase.com. Choose region **eu-west-1 (Ireland)**.
2. **SQL Editor**: run every file in `supabase/migrations/` **in order** (`0001` … `0009`).
3. **Authentication › Providers › Email**: turn **off** "Allow new users to sign up" (logins are by invitation only).
4. **Authentication › URL Configuration**: Site URL = your app address (e.g. `https://portal.bitstorage.ie`); add `https://portal.bitstorage.ie/**` to Redirect URLs.
5. **Authentication › Email Templates**: change the link in two templates so invitations and password resets work with server-side login:
   - **Invite user**: `<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/account">Accept the invitation</a>`
   - **Reset password**: `<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/account">Reset password</a>`
6. **Authentication › SMTP**: Supabase's built-in mailer only sends a few emails per hour. Set custom SMTP (Resend gives you SMTP credentials too).
7. **Project Settings › API**: copy the URL, the publishable (anon) key and the secret (service_role) key.

### First admin
Create yourself in **Authentication › Users › Add user** (tick "auto confirm"), then in the SQL editor:
```sql
update public.profiles set role = 'admin' where email = 'you@example.ie';
```
Everyone else is invited from the app (Users page for staff, the customer's page for customer logins).

## 2. Email (Resend)
Sign up at resend.com, add and verify your sending domain (DNS records), create an API key. Set `RESEND_API_KEY` and `EMAIL_FROM`.
Every email sent (or failed) is listed under **Settings › Recent emails**.

## 3. Stripe
1. **Settings › Payment methods**: turn on **Cards** and **SEPA Direct Debit**. (Only methods switched on here are offered.)
2. **Developers › API keys**: copy the secret key → `STRIPE_SECRET_KEY`.
3. **Developers › Webhooks › Add endpoint**: `https://<your-site>/api/stripe/webhook`, events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `payment_intent.succeeded`, `payment_intent.processing`, `payment_intent.payment_failed`, `mandate.updated`.
   Copy the signing secret → `STRIPE_WEBHOOK_SECRET`.
4. Test first with test keys (`sk_test_…`): Stripe test IBAN `IE29AIBK93115212345678` succeeds; card `4242 4242 4242 4242`.

SEPA Direct Debit takes up to about 5 business days to confirm. The invoice shows "collecting" until the webhook confirms it.

## 4. Vercel
1. Put this folder in a Git repository (GitHub) and import it at vercel.com.
2. Add every variable from `.env.example` under **Settings › Environment Variables** (`NEXT_PUBLIC_CURRENCY=EUR`).
3. Deploy. `vercel.json` sets the region to Dublin (`dub1`) and two cron jobs:
   - Monday 06:00 UTC – weekly billing, invoice emails + automatic collection, expiry notices
   - Daily 02:30 UTC – send any invoices that did not go out, push to Sage (cloud)
   Vercel signs cron calls with `CRON_SECRET` automatically.

## 5. Sage
- **Nominal codes**: the Sage 50 default chart of accounts is pre-loaded, with 4000/4001/4002 named Frozen/Chilled/Ambient storage sales. Rename or add codes under **Accounts › Nominal codes** so they match your Sage company exactly.
- **Tax codes**: pre-loaded for Ireland: T0 0%, T1 23%, T2 exempt, T3 13.5%, T5 9%, T9 outside scope. **Check these match Sage** (Settings › Configuration › Tax Codes) and change them under **Settings** if not.
- **Sage 50**: Accounts › Sage › Download CSV, import in Sage, then press "Mark as imported". Customer account refs in this app must equal the Sage account refs.
- **Sage Accounting (cloud)**: register an app at developerselfservice.sageone.com with callback `https://<your-site>/api/sage/callback`, set `SAGE_CLIENT_ID`/`SAGE_CLIENT_SECRET`, then Accounts › Sage › Connect. **This connection has not been tested against a live Sage company yet**; try it on a Sage trial company before relying on it.

## 6. Before going live
1. **Settings**: company details, VAT number, CRO number, IBAN (printed on invoices).
2. **Rates**: set the Frozen / Chilled / Ambient weekly prices (they start at €0.00, and a €0 charge is never invoiced).
3. **Locations**: create your racking (e.g. Frozen aisle A, 20 bays × 4 levels).
4. **Customers**: add each customer with the same account ref as in Sage, then invite their staff to the portal.
5. **Opening balances**: Accounts › Journals, dated the day before go-live, so the balance sheet matches Sage.
6. Book existing stock in through Goods in with the real received dates.

## Daily use
| Who | Where |
|---|---|
| Goods arrive | Goods in › New (or open the customer's pre-advice) › add lines › **Receive** › print labels › put away each line by scanning/typing the location. Customer is emailed automatically when the last pallet is located. |
| Customer wants stock | Goods out › New › choose quantities (pallets picked FEFO automatically), or the customer requests it in the portal. |
| Picker | **Pick list** on a phone or handheld: walk the locations in order and scan each pallet label (or tap "Picked"). |
| Vehicle leaves | Open the order › **Dispatch**. Storage charging stops from that date; customer is emailed what left and what remains. |
| Monday | Nothing to do: invoices are created, emailed and collected automatically. Check Invoices › "Payment failed". |

## Developing
```bash
npm install
cp .env.example .env.local   # fill in
npm run dev                   # http://localhost:3000
npm run test:db               # runs every migration in an in-memory Postgres and tests the stock/billing/ledger/security logic
npx tsc --noEmit && npm run lint
```
`scripts/embed-logo.mjs` regenerates the logo used on invoice PDFs from `public/bit-storage-logo.jpeg`.

### How storage charging works (for checking invoices)
For each customer, temperature zone and Monday–Sunday week, a pallet counts if it was received on or before Sunday and had not been dispatched before Monday (Irish local dates). Arrival day and departure day both count.
- *Part week = full week* (default): quantity = number of such pallets.
- *Daily pro-rata*: quantity = total pallet-days ÷ 7.

The pallets behind every storage line are stored (`invoice_line_pallets`) so any invoice can be traced to the exact pallets and days.
