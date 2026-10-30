/**
 * Echte beheerdersrechten voor zware acties (bulkimport, crawls): de sessie moet met het teamwachtwoord
 * (APP_PASSWORD) aangemeld zijn. Enkel een naam ingeven volstaat hiervoor niet.
 */
import { requireSession } from "@/lib/session";
import type { Session } from "@/lib/auth";

export async function requireRealAdmin(): Promise<Session> {
  const s = await requireSession();
  if (!s.admin) {
    throw new Response(JSON.stringify({ error: "Enkel voor beheerders: ontgrendel /admin met het teamwachtwoord." }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }
  return s;
}
