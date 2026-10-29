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
      <header className="h-16 bg-navy text-white flex items-center px-5 gap-3">
        <Link href="/" className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-white.png" alt="RecruitrLAB" width={56} height={34} className="h-8 w-auto" />
          <span className="font-semibold text-[17px]">
            Matchr<span className="text-gold">.</span>
          </span>
        </Link>
        <span className="eyebrow text-white/50">Instellingen</span>
        <Link href="/" className="ml-auto text-sm font-semibold rounded-full px-4 py-1.5 bg-gold text-navy hover:bg-gold-deep">
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
