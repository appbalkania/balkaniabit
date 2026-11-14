import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { NavLink } from "./client";
import { signOut } from "@/app/auth-actions";

export type NavSection = { title?: string; items: { href: string; label: string; exact?: boolean }[] };

/** App frame: navy sidebar on desktop, collapsible menu on a phone or handheld scanner. */
export function Shell({ nav, user, badge, children }: { nav: NavSection[]; user: string; badge: string; children: ReactNode }) {
  const links = (
    <nav className="space-y-4">
      {nav.map((s, i) => (
        <div key={i}>
          {s.title ? <div className="mb-1 px-3 text-[11px] font-semibold tracking-wider text-blue-300 uppercase">{s.title}</div> : null}
          <div className="space-y-0.5">
            {s.items.map((it) => (
              <NavLink key={it.href} href={it.href} exact={it.exact}>
                {it.label}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
  const account = (
    <div className="border-t border-white/10 pt-3 text-xs text-blue-200">
      <div className="truncate px-3" title={user}>
        {user}
      </div>
      <div className="mt-1 flex items-center gap-1 px-1">
        <Link href="/account" className="rounded px-2 py-1 hover:bg-white/10 hover:text-white">
          Account
        </Link>
        <form action={signOut}>
          <button className="cursor-pointer rounded px-2 py-1 hover:bg-white/10 hover:text-white">Sign out</button>
        </form>
      </div>
    </div>
  );
  const logo = (
    <div className="rounded-md bg-white p-1.5">
      <Image src="/bit-storage-logo.jpeg" alt="BIT Storage" width={320} height={160} priority className="h-auto w-full" />
    </div>
  );

  return (
    <div className="min-h-screen md:flex">
      {/* desktop sidebar */}
      <aside className="bg-navy no-print hidden w-56 shrink-0 flex-col gap-4 p-3 md:flex">
        {logo}
        <div className="px-3 text-[11px] font-semibold tracking-wider text-emerald-300 uppercase">{badge}</div>
        <div className="flex-1 overflow-y-auto">{links}</div>
        {account}
      </aside>

      {/* mobile top bar */}
      <details className="bg-navy no-print md:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-white">
          <span className="font-bold">BIT Storage</span>
          <span className="rounded border border-white/30 px-2 py-0.5 text-sm">Menu</span>
        </summary>
        <div className="space-y-4 px-3 pb-4">
          {links}
          {account}
        </div>
      </details>

      <main className="min-w-0 flex-1 p-4 md:p-6 lg:p-8">{children}</main>
    </div>
  );
}
