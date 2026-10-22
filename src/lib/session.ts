import { cookies } from "next/headers";
import { verifySession, type Session } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/config";
import { env } from "@/lib/env";

export async function currentSession(): Promise<Session | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value, env.APP_PASSWORD);
}

export async function requireSession(): Promise<Session> {
  const s = await currentSession();
  if (!s) throw new Response(JSON.stringify({ error: "Niet aangemeld." }), { status: 401 });
  return s;
}
