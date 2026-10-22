import { Suspense } from "react";
import { App } from "@/components/App";
import { currentSession } from "@/lib/session";

async function AppWithSession() {
  const session = await currentSession();
  return <App me={session?.name ?? ""} />;
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AppWithSession />
    </Suspense>
  );
}
