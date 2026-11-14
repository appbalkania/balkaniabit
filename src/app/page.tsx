import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import "./landing.css";

import hero from "../../public/landing/balkania-hero-night.jpeg";
import racking from "../../public/landing/balkania-hero-warehouse.jpeg";
import fleet from "../../public/landing/balkania-hero-fleet.jpeg";
import logo from "../../public/bit-storage-logo.jpeg";

export const metadata: Metadata = {
  title: { absolute: "BIT Storage · Frozen, chilled and ambient pallet storage in Dublin" },
  description:
    "Pallet storage in frozen, chilled and ambient zones at Huntstown Business Park, Dublin 11. Part of Balkania Group, with a live client area for stock, collections and invoices.",
  robots: { index: true, follow: true },
};

type Company = {
  company_name: string | null;
  legal_name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  vat_number: string | null;
};

// Defaults match the row seeded by migration 0001; Admin › Settings overrides them.
const FALLBACK: Company = {
  company_name: "BIT Storage",
  legal_name: "Balkania International Trading LTD",
  address: "Sanguine House\nHuntstown Business Park\nCappagh Road\nDublin 11\nD11 T9TF, Ireland",
  phone: null,
  email: null,
  vat_number: "IE4281815IH",
};

/** Public company details, read with the service key (anonymous visitors have no table access). */
async function getCompany(): Promise<Company> {
  try {
    const { data } = await createAdminClient()
      .from("company_settings")
      .select("company_name, legal_name, address, phone, email, vat_number")
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

// An example of what a client sees in the portal. Illustrative rows, not real stock.
const SAMPLE = [
  { goods: "Frozen paratha", zone: "frozen", batch: "B2611", expiry: "Mar 2027", pallets: 6, loc: "F-A-03-2" },
  { goods: "Halloumi 250g", zone: "chilled", batch: "H0914", expiry: "Dec 2026", pallets: 3, loc: "C-B-01-1", soon: true },
  { goods: "Basmati rice 10kg", zone: "ambient", batch: "R4471", expiry: "Aug 2027", pallets: 12, loc: "A-D-07-3" },
  { goods: "Pizza boxes 12in", zone: "ambient", batch: "P0102", expiry: "None", pallets: 4, loc: "A-E-02-1" },
] as const;

export default async function Home() {
  const [company, signedIn] = await Promise.all([getCompany(), isSignedIn()]);
  const quoteHref = company.email
    ? `mailto:${company.email}?subject=${encodeURIComponent("Pallet storage quote")}`
    : "#contact";
  const client = signedIn
    ? { href: "/dashboard", label: "Open client area" }
    : { href: "/login", label: "Client login" };

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-wrap">
          <Link href="/" className="lp-nav-logo" aria-label="BIT Storage home">
            <Image src={logo} alt="BIT Storage, part of Balkania Group" preload sizes="132px" />
          </Link>
          <nav className="lp-nav-links" aria-label="Main">
            <a href="#zones">Storage</a>
            <a href="#client-area">Client area</a>
            <a href="#contact">Contact</a>
            <Link href={client.href} className="lp-btn">
              {client.label}
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="lp-hero" aria-labelledby="hero-title">
          <Image
            src={hero}
            alt="The Balkania building at Huntstown Business Park, lit at night"
            className="lp-hero-img"
            fill
            preload
            sizes="100vw"
            placeholder="blur"
          />
          <div className="lp-wrap">
            <div className="lp-hero-copy">
              <h1 id="hero-title">Pallet storage, frozen to ambient.</h1>
              <p>Racked storage in Dublin 11, with your stock online every day.</p>
              <div className="lp-actions">
                <a href={quoteHref} className="lp-btn lp-btn-primary">
                  Request a quote
                </a>
                <Link href={client.href} className="lp-btn lp-btn-quiet">
                  {client.label}
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section id="zones" className="lp-section" aria-labelledby="zones-title">
          <div className="lp-wrap">
            <div className="lp-intro">
              <h2 id="zones-title">Three temperature zones under one roof.</h2>
              <p>
                Every location is zoned, and putaway is checked against it: a frozen pallet can only go into frozen racking.
                Storage is charged per pallet, per week.
              </p>
            </div>
            <div className="lp-zones">
              <div className="lp-zone lp-zone-frozen">
                <h3>Frozen</h3>
                <p>Frozen food and ingredients, held in frozen racking.</p>
              </div>
              <div className="lp-zone lp-zone-chilled">
                <h3>Chilled</h3>
                <p>Dairy, meat and short-life lines, picked earliest expiry first.</p>
              </div>
              <div className="lp-zone lp-zone-ambient">
                <h3>Ambient</h3>
                <p>Dry goods, drinks and packaging on standard racking.</p>
              </div>
            </div>
          </div>
        </section>

        <div className="lp-wrap">
          <figure className="lp-figure">
            <Image src={racking} alt="Aisles of pallet racking, labelled C to J, stocked with palletised goods" sizes="(max-width: 1200px) 100vw, 1200px" placeholder="blur" />
            <figcaption>Pallet racking at Huntstown Business Park, Dublin 11.</figcaption>
          </figure>
        </div>

        <section id="client-area" className="lp-section lp-portal" aria-labelledby="portal-title">
          <div className="lp-wrap lp-portal-grid">
            <div>
              <h2 id="portal-title">Your stock, visible every day.</h2>
              <ul className="lp-list">
                <li>Stock by product, with batch, expiry date and location.</li>
                <li>Pre-advise deliveries and request collections online.</li>
                <li>An email when goods arrive and when they leave.</li>
                <li>Weekly invoices, paid by card or SEPA Direct Debit.</li>
              </ul>
              <div className="lp-actions">
                <Link href={client.href} className="lp-btn lp-btn-quiet">
                  {client.label}
                </Link>
              </div>
              <p className="lp-note">Logins are by invitation; ask us for one.</p>
            </div>

            <div className="lp-stock" role="figure" aria-label="Example of the client stock screen">
              <div className="lp-stock-head">
                <strong>Stock on hand</strong>
                <span>Example</span>
              </div>
              <div className="lp-stock-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Goods</th>
                      <th scope="col">Zone</th>
                      <th scope="col">Expiry</th>
                      <th scope="col" className="num">
                        Pallets
                      </th>
                      <th scope="col">Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SAMPLE.map((r) => (
                      <tr key={r.batch}>
                        <td>{r.goods}</td>
                        <td>
                          <span className={`lp-tag lp-zone-${r.zone}`}>{r.zone}</span>
                        </td>
                        <td className={"soon" in r ? "soon" : undefined}>{r.expiry}</td>
                        <td className="num">{r.pallets}</td>
                        <td className="loc">{r.loc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        <section id="contact" className="lp-section" aria-labelledby="contact-title">
          <div className="lp-wrap lp-contact-grid">
            <div>
              <h2 id="contact-title">Talk to us about space.</h2>
              <dl className="lp-facts">
                <div>
                  <dt>Address</dt>
                  <dd>{company.address}</dd>
                </div>
                {company.phone && (
                  <div>
                    <dt>Phone</dt>
                    <dd>
                      <a href={`tel:${company.phone.replace(/[^\d+]/g, "")}`}>{company.phone}</a>
                    </dd>
                  </div>
                )}
                {company.email && (
                  <div>
                    <dt>Email</dt>
                    <dd>
                      <a href={quoteHref}>{company.email}</a>
                    </dd>
                  </div>
                )}
              </dl>
              <div className="lp-actions">
                <a href={quoteHref} className="lp-btn lp-btn-primary">
                  Request a quote
                </a>
              </div>
            </div>
            <Image src={fleet} alt="The Balkania warehouse with its delivery fleet lined up at the loading doors" sizes="(max-width: 900px) 100vw, 700px" placeholder="blur" />
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap">
          <Image src={logo} alt="BIT Storage" sizes="112px" />
          <div>
            <p>
              {company.company_name} is part of Balkania Group. {company.legal_name}
              {company.vat_number ? `, VAT ${company.vat_number}` : ""}.
            </p>
            <p>
              <Link href={client.href}>{client.label}</Link>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
