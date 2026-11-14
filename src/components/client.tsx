"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

/** Submit button that disables itself while the server action runs (prevents double submits). */
export function Submit({
  children,
  className = "btn btn-primary",
  confirm,
  pendingText = "Working…",
}: {
  children: ReactNode;
  className?: string;
  confirm?: string;
  pendingText?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={className}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? pendingText : children}
    </button>
  );
}

export function NavLink({ href, exact, children }: { href: string; exact?: boolean; children: ReactNode }) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(href + "/");
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`block rounded-md px-3 py-1.5 text-sm transition-colors ${
        active ? "bg-brand font-semibold text-white" : "text-blue-100 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </Link>
  );
}

export function PrintButton({ children = "Print" }: { children?: ReactNode }) {
  return (
    <button type="button" className="btn btn-outline no-print" onClick={() => window.print()}>
      {children}
    </button>
  );
}

/** Tick / untick every checkbox with the given name inside the same form. */
export function CheckAll({ name }: { name: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Select all"
      onChange={(e) => {
        const form = e.currentTarget.closest("form");
        form?.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`).forEach((c) => {
          c.checked = e.currentTarget.checked;
        });
      }}
    />
  );
}
