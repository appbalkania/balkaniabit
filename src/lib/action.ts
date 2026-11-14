import { redirect } from "next/navigation";

/** Finish a server action by returning to `path` with a green or red banner. */
export function back(path: string, kind: "ok" | "error", message: string): never {
  const [p, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.delete("ok");
  params.delete("error");
  params.set(kind, message.slice(0, 300));
  redirect(`${p}?${params.toString()}`);
}

export const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
export const orNull = (s: string) => (s === "" ? null : s);
export function num(fd: FormData, key: string) {
  const v = Number(str(fd, key));
  return Number.isFinite(v) ? v : NaN;
}
export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Turn a Postgres / PostgREST error into something a user can act on. */
export function dbMessage(error: { message?: string; code?: string } | null | undefined) {
  if (!error) return "Something went wrong";
  if (error.code === "23505") return "That already exists (duplicate value)";
  if (error.code === "23503") return "That record is in use elsewhere and cannot be removed or changed";
  if (error.code === "42501") return "You do not have permission to do that";
  return error.message ?? "Something went wrong";
}
