import { Suspense } from "react";
import { redirect } from "next/navigation";
import { MapExplorer } from "@/components/kaart/MapExplorer";
import { currentSession } from "@/lib/session";

export const metadata = { title: "Kantorenkaart · Matchr" };

async function KaartWithSession() {
  const session = await currentSession();
  if (!session) redirect("/login");
  return <MapExplorer />;
}

export default function KaartPage() {
  return (
    <Suspense fallback={null}>
      <KaartWithSession />
    </Suspense>
  );
}
