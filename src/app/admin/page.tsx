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
      <header className="h-14 border-b border-line flex items-center px-4 gap-3">
        <Link href="/" className="flex items-center gap-3">
          <span className="inline-block w-6 h-6 rounded-md bg-accent" aria-hidden />
          <span className="font-semibold">Matchr</span>
        </Link>
        <span className="text-xs text-ink-faint">Instellingen</span>
        <Link href="/" className="ml-auto text-sm border border-line rounded-md px-3 py-1.5 hover:bg-paper-soft">
          Terug naar Matchr
        </Link>
      </header>
      <div className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-xl font-semibold mb-1">API-keys en instellingen</h1>
        <p className="text-sm text-ink-soft mb-8">
          Plak hier de keys. Ze worden versleuteld opgeslagen en nooit meer getoond. Een waarde hier gaat voor op de omgevingsvariabele in Vercel.
        </p>
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
