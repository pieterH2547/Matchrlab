import { NextResponse, type NextRequest } from "next/server";
import { verifySession } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/config";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const secret = process.env.APP_PASSWORD;
  if (!secret) {
    return new NextResponse("APP_PASSWORD is niet ingesteld.", { status: 500 });
  }
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value, secret);

  // Geplande taak: eigen controle in de route (CRON_SECRET of de Vercel-cron), geen sessie.
  if (pathname === "/api/cron/recrawl") return NextResponse.next();
  if (pathname === "/login" || pathname === "/api/auth/login") {
    if (session && pathname === "/login") return NextResponse.redirect(new URL("/", request.url));
    return NextResponse.next();
  }
  if (!session) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Niet aangemeld." }, { status: 401 });
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|icon.png|logo-[a-z-]+\\.png).*)"],
};
