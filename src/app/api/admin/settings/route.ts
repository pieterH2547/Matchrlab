import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { deleteSetting, isSettingKey, setSetting, settingsStatus, SETTING_INFO } from "@/lib/settings";
import { resolveProvider } from "@/lib/search";

/** Instellingen staan open voor iedereen die aangemeld is; keys worden nooit teruggestuurd. */
async function requireAdmin() {
  return requireSession();
}

function errorResponse(e: unknown) {
  if (e instanceof Response) return e;
  return NextResponse.json({ error: e instanceof Error ? e.message : "Onbekende fout." }, { status: 500 });
}

export async function GET() {
  try {
    await requireAdmin();
    const [settings, provider] = await Promise.all([settingsStatus(), resolveProvider()]);
    return NextResponse.json({ settings, provider });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireAdmin();
    const body = (await request.json().catch(() => ({}))) as { key?: string; value?: string };
    const key = body.key ?? "";
    const value = (body.value ?? "").trim();
    if (!isSettingKey(key)) return NextResponse.json({ error: "Onbekende instelling." }, { status: 400 });
    if (!value) return NextResponse.json({ error: "Waarde is leeg." }, { status: 400 });
    if (value.length > 4000) return NextResponse.json({ error: "Waarde is te lang." }, { status: 400 });
    const opts = SETTING_INFO[key].options;
    if (opts && !opts.includes(value)) return NextResponse.json({ error: `Kies uit: ${opts.join(", ")}.` }, { status: 400 });
    if (key === "ANTHROPIC_MONTHLY_BUDGET_EUR" && !(Number(value) > 0)) return NextResponse.json({ error: "Budget moet een getal boven 0 zijn." }, { status: 400 });
    await setSetting(key, value, session.name);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin();
    const body = (await request.json().catch(() => ({}))) as { key?: string };
    const key = body.key ?? "";
    if (!isSettingKey(key)) return NextResponse.json({ error: "Onbekende instelling." }, { status: 400 });
    await deleteSetting(key);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
