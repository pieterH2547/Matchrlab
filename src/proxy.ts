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

  if (pathname === "/login" || pathname === "/api/auth/login") {
    if (session && pathname === "/login" && !(request.nextUrl.searchParams.get("admin") && !session.admin)) return NextResponse.redirect(new URL("/", request.url));
    return NextResponse.next();
  }
  const wantsAdmin = pathname === "/admin" || pathname.startsWith("/api/admin/");
  if (!session || (wantsAdmin && !session.admin)) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: wantsAdmin ? "Teamwachtwoord nodig." : "Niet aangemeld." }, { status: 401 });
    const url = new URL("/login", request.url);
    if (wantsAdmin) url.searchParams.set("admin", "1");
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
