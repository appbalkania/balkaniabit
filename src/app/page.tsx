import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { RetractingBar } from "@/components/retracting-bar";
import "./landing.css";

import interior from "../../public/landing/warehouse-interior.jpg";
import exterior from "../../public/landing/warehouse-exterior.jpg";
import aisle from "../../public/landing/racking-aisle.jpg";
import logo from "../../public/palletpoint-logo.jpg";

export const metadata: Metadata = {
  title: { absolute: "PalletPoint Storage: frozen, chilled and ambient pallet storage in Dublin" },
  description:
    "Pallet storage in frozen, chilled and ambient zones in Dublin, with a live client area for stock, collections and invoices.",
  robots: { index: true, follow: true },
};

type Company = {
  company_name: string | null;
  legal_name: string | null;
  phone: string | null;
  email: string | null;
  vat_number: string | null;
};

// Defaults match the company row (migration 0010); Admin › Settings overrides them.
const FALLBACK: Company = {
  company_name: "PalletPoint Storage",
  legal_name: "BIT LTD",
  phone: null,
  email: "office@palletpoint.ie",
  vat_number: "IE4281815IH",
};

/** Public company details, read with the service key (anonymous visitors have no table access). */
async function getCompany(): Promise<Company> {
  try {
    const { data } = await createAdminClient()
      .from("company_settings")
      .select("company_name, legal_name, phone, email, vat_number")
      .single();
    if (!data) return FALLBACK;
    const merged = { ...FALLBACK };
    for (const k of Object.keys(FALLBACK) as (keyof Company)[]) merged[k] = data[k] || FALLBACK[k];
    return merged;
  } catch {
    return FALLBACK;
  }
}

async function isSignedIn() {
  try {
    return Boolean(await getSession());
  } catch {
    return false;
  }
}

// A sample of the client portal's collection screen. Illustrative rows, not real stock.
const PICK = [
  { label: "PAL-0000412", goods: "Frozen paratha", expiry: "Mar 2027", loc: "F-A-03-2", on: true },
  { label: "PAL-0000413", goods: "Frozen paratha", expiry: "Mar 2027", loc: "F-A-03-2", on: true },
  { label: "PAL-0000398", goods: "Basmati rice 10kg", expiry: "Aug 2027", loc: "A-D-07-3", on: false },
  { label: "PAL-0000377", goods: "Pizza boxes 12in", expiry: "None", loc: "A-E-02-1", on: false },
] as const;

// The charge types the billing system invoices (migration 0006). Prices are agreed per customer.
const RATES = [
  { name: "Frozen storage", basis: "Per pallet, per week", note: "Frozen racking only.", zone: "frozen" },
  { name: "Chilled storage", basis: "Per pallet, per week", note: "Picked earliest expiry first.", zone: "chilled" },
  { name: "Ambient storage", basis: "Per pallet, per week", note: "Dry goods, drinks, packaging.", zone: "ambient" },
  { name: "Handling in", basis: "Per pallet received", note: "Each pallet gets a QR label." },
  { name: "Handling out", basis: "Per pallet dispatched", note: "Storage stops when it leaves." },
  { name: "Other services", basis: "Quoted per job", note: "Re-wrapping, labelling, one-offs." },
] as const;

// Lets the owner drop real (or AI-generated) pictures into the named slots without touching the layout.
const SLOT_SCRIPT = `window.hallmarkSlots = (m) => { for (const [k, v] of Object.entries(m)) { const s = document.querySelector(\`[data-slot="\${k}"]\`); if (!s) continue; const im = new Image(); im.src = typeof v === 'string' ? v : v.src; im.alt = (typeof v === 'object' && v.alt) || s.dataset.alt || ''; s.querySelectorAll(':scope > img').forEach((o) => o.remove()); s.prepend(im); } };
document.querySelectorAll('[data-slot] img').forEach((i) => { if (i.complete && !i.naturalWidth) i.remove(); else i.addEventListener('error', () => i.remove(), { once: true }); });`;

export default async function Home() {
  const [company, signedIn] = await Promise.all([getCompany(), isSignedIn()]);
  const quoteHref = company.email
    ? `mailto:${company.email}?subject=${encodeURIComponent("Pallet storage quote")}`
    : "#contact";
  const client = signedIn
    ? { href: "/dashboard", label: "Open client area" }
    : { href: "/login", label: "Client login" };

  return (
    <div className="site">
      <div className="banner">
        <div className="container">
          <span className="banner-place">
            {company.email ? <a href={quoteHref}>{company.email}</a> : "Pallet storage in Dublin"}
          </span>
          <Link href={client.href}>{client.label}</Link>
        </div>
      </div>
      <RetractingBar className="bar">
        <div className="container">
          <Link href="/" className="bar-logo" aria-label="PalletPoint Storage home">
            <Image src={logo} alt="PalletPoint Storage" preload sizes="180px" />
          </Link>
          <nav className="bar-links" aria-label="Main">
            <a href="#rates">Rates</a>
            <a href="#client-area">Client area</a>
            <a href="#contact">Contact</a>
            <a href={quoteHref} className="btn btn-primary">
              Request a quote
            </a>
          </nav>
        </div>
      </RetractingBar>

      <main>
        <section className="ledge" aria-labelledby="hero-title">
          <div className="ledge-field" data-slot="hero" data-alt="Warehouse interior with pallet racking and loading doors">
            <Image
              src={interior}
              alt="Warehouse interior with full pallet racking on the left and loading doors on the right"
              fill
              preload
              sizes="100vw"
              placeholder="blur"
            />
          </div>
          <div className="container ledge-base">
            <h1 id="hero-title">Frozen, chilled, ambient.</h1>
            <div className="ledge-side">
              <p className="lead">Pallet storage in Dublin, with your stock online every day.</p>
              <div className="actions">
                <a href={quoteHref} className="btn btn-primary">
                  Request a quote
                </a>
                <Link href={client.href} className="btn btn-outline">
                  {client.label}
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section id="rates" className="rates" aria-labelledby="rates-title">
          <div className="container rates-grid">
            <div className="rates-head">
              <h2 id="rates-title">Six charges, each one named.</h2>
              <p className="lead">Every invoice line traces back to the pallets and days behind it.</p>
            </div>
            <div className="rates-body">
              <ul id="zones" className="rate-list">
                {RATES.map((r) => (
                  <li key={r.name} className="rate" data-zone={"zone" in r ? r.zone : undefined}>
                    <h3>{r.name}</h3>
                    <span className="rate-basis">{r.basis}</span>
                    <span className="rate-note">{r.note}</span>
                  </li>
                ))}
              </ul>
              <div className="rates-foot">
                <p>Rates are agreed per customer.</p>
                <a href={quoteHref} className="btn btn-outline">
                  Ask for a price
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="showcase" aria-label="The warehouse">
          <div className="container">
            <div className="showcase-grid">
              <div className="showcase-frame showcase-wide" data-slot="exterior" data-alt="Warehouse exterior with loading docks">
                <Image
                  src={exterior}
                  alt="Warehouse exterior with dock doors, a truck and forklifts moving pallets in the yard"
                  sizes="(max-width: 960px) 100vw, 864px"
                  placeholder="blur"
                />
              </div>
              <div className="showcase-frame showcase-tall" data-slot="aisle" data-alt="A tall pallet racking aisle">
                <Image
                  src={aisle}
                  alt="A long aisle of orange pallet racking, stacked to the ceiling with wrapped pallets"
                  sizes="(max-width: 960px) 100vw, 416px"
                  placeholder="blur"
                />
              </div>
            </div>
            <p className="showcase-caption">Every location is zoned: a frozen pallet only goes into frozen racking.</p>
          </div>
        </section>

        <section id="client-area" className="portal" aria-labelledby="portal-title">
          <div className="container portal-grid">
            <div className="app app-pick" role="figure" aria-label="Example of the collection request screen" data-slot="portal" data-kind="product">
              <div className="app-top">
                <span className="app-account">Request a collection</span>
                <span className="app-hint">Example</span>
              </div>
              <ul className="pick-list">
                {PICK.map((p) => (
                  <li key={p.label} className={p.on ? "is-on" : undefined}>
                    <span className="pick-box" aria-hidden="true" />
                    <span className="pick-goods">
                      <strong>{p.goods}</strong>
                      <span className="loc">{p.label}</span>
                    </span>
                    <span>{p.expiry}</span>
                    <span className="loc">{p.loc}</span>
                  </li>
                ))}
              </ul>
              <div className="app-foot">
                <span>2 pallets selected</span>
                <span className="app-btn" aria-hidden="true">
                  Request collection
                </span>
              </div>
            </div>
            <div className="portal-text">
              <h2 id="portal-title">Your stock, every day.</h2>
              <ul className="portal-list">
                <li>Stock by product, with expiry and location.</li>
                <li>Pre-advise deliveries and request collections.</li>
                <li>An email when goods arrive and leave.</li>
                <li>Weekly invoices, paid by card or SEPA Direct Debit.</li>
              </ul>
              <div className="actions">
                <Link href={client.href} className="btn btn-on-field">
                  {client.label}
                </Link>
              </div>
              <p className="portal-note">Logins are by invitation; ask us for one.</p>
            </div>
          </div>
        </section>

        <section id="contact" className="contact" aria-labelledby="contact-title">
          <div className="container">
            <h2 id="contact-title" className="statement">
              Talk to us about space.
            </h2>
            <div className="contact-row">
              <a href={quoteHref} className="btn btn-primary">
                Request a quote
              </a>
              {company.phone && (
                <a className="contact-link" href={`tel:${company.phone.replace(/[^\d+]/g, "")}`}>
                  {company.phone}
                </a>
              )}
              {company.email && (
                <a className="contact-link" href={quoteHref}>
                  {company.email}
                </a>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="container">
          <p className="footer-statement">Pallet space in Dublin, frozen to ambient.</p>
          <nav className="footer-links" aria-label="Footer">
            <a href="#rates">Rates</a>
            <a href="#client-area">Client area</a>
            <a href="#contact">Contact</a>
            <Link href={client.href}>{client.label}</Link>
          </nav>
          <div className="footer-legal">
            <p>
              {company.legal_name}
              {company.vat_number ? `, VAT ${company.vat_number}` : ""}
            </p>
          </div>
        </div>
      </footer>
      <script dangerouslySetInnerHTML={{ __html: SLOT_SCRIPT }} />
    </div>
  );
}
