import { NextResponse } from "next/server";
import { newSession, passwordMatches, sessionCookieOptions, signSession } from "@/lib/auth";
import { env } from "@/lib/env";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { password?: string; name?: string };
  const name = (body.name ?? "").trim();
  const password = body.password ?? "";
  if (!name) return NextResponse.json({ error: "Vul je naam in." }, { status: 400 });
  if (!passwordMatches(password, env.APP_PASSWORD)) {
    return NextResponse.json({ error: "Wachtwoord klopt niet." }, { status: 401 });
  }
  const token = await signSession(newSession(name), env.APP_PASSWORD);
  const res = NextResponse.json({ ok: true, name });
  const { name: cookieName, ...opts } = sessionCookieOptions();
  res.cookies.set(cookieName, token, opts);
  return res;
}
