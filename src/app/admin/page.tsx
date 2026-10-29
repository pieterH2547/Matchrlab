import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AdminPanel } from "@/components/AdminPanel";
import { currentSession } from "@/lib/session";

async function AdminWithSession() {
  const session = await currentSession();
  if (!session) redirect("/login");
  return (
    <main className="min-h-screen">
      <header className="h-14 border-b border-line flex items-center px-5 gap-3">
        <Link href="/" className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-navy-sm.png" alt="RecruitrLAB" width={40} height={23} className="h-[22px] w-auto" />
          <span className="font-semibold text-[16px] text-navy">
            Matchr<span className="text-gold">.</span>
          </span>
        </Link>
        <span className="text-[13px] text-ink-faint">Instellingen</span>
        <Link href="/" className="ml-auto text-sm text-ink-soft hover:text-navy">
          ← Terug naar Matchr
        </Link>
      </header>
      <div className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-xl font-semibold mb-1">Instellingen</h1>
        <p className="text-sm text-ink-soft mb-8">Plak per tool de key en klik Opslaan. Matchr test hem meteen. Enkel OpenAI is verplicht; Serper is sterk aangeraden.</p>
        <AdminPanel me={session.name} />
      </div>
    </main>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={null}>
      <AdminWithSession />
    </Suspense>
  );
}
