import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-navy-sm.png" alt="RecruitrLAB" width={160} height={92} className="w-24 h-auto" />
          <h1 className="mt-5 text-3xl font-bold tracking-tight text-navy">
            Matchr<span className="text-gold">.</span>
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            De vacaturezoeker van RecruitrLAB
          </p>
        </div>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
