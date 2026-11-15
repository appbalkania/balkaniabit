"use client";

import { useEffect } from "react";

const WELCOME = "?ok=" + encodeURIComponent("Welcome - please choose a password now");
const EXPIRED = "?error=" + encodeURIComponent("That link has expired or was already used - please ask for a new one");

/**
 * Supabase's default invitation and reset emails sign the person in by putting the
 * session in the URL fragment (#access_token=...&type=invite), which the server never
 * sees. This picks it up on whatever page Supabase lands on, stores the session as a
 * cookie via /auth/session, and sends invitees straight to choose a password.
 */
export function HashSession() {
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.includes("access_token=") && !hash.includes("error=")) return;
    const p = new URLSearchParams(hash.slice(1));
    // drop the tokens from the address bar and history straight away
    history.replaceState(null, "", window.location.pathname + window.location.search);

    if (p.get("error")) {
      window.location.replace("/login" + EXPIRED);
      return;
    }
    const type = p.get("type");
    fetch("/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ access_token: p.get("access_token"), refresh_token: p.get("refresh_token") }),
    })
      .then((r) => {
        if (!r.ok) throw new Error();
        window.location.replace(type === "invite" || type === "recovery" ? "/account" + WELCOME : "/dashboard");
      })
      .catch(() => window.location.replace("/login" + EXPIRED));
  }, []);
  return null;
}
