import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8">
          <span className="inline-block w-7 h-7 rounded-md bg-accent" aria-hidden />
          <span className="text-lg font-semibold">Matchr</span>
          <span className="text-sm text-ink-faint">RecruitrLAB</span>
        </div>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
