import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/** Vercel Cron sends "Authorization: Bearer <CRON_SECRET>". Anything else is refused. */
export function cronAuthorised(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}
