"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RunView, Profile } from "@/lib/pipeline/types";
import { createRun, fetchIndex, fetchThread, runStep, type RunsIndex } from "./api";
import { Topbar } from "./Topbar";
import { Sidebar } from "./Sidebar";
import { Composer } from "./Composer";
import { Thread } from "./Thread";

export function App({ me }: { me: string }) {
  const [index, setIndex] = useState<RunsIndex | null>(null);
  const [thread, setThread] = useState<RunView[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingUser, setPendingUser] = useState<{ text: string; attachment?: { name: string; size: number } } | null>(null);
  const activeRun = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshIndex = useCallback(async () => {
    try {
      setIndex(await fetchIndex());
    } catch {
      /* zijbalk blijft zoals hij was */
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void refreshIndex();
      try {
        if (window.localStorage.getItem("matchr:sidebar") === "closed") setSidebarOpen(false);
      } catch {
        /* geen localStorage */
      }
    }, 0);
    return () => clearTimeout(t);
  }, [refreshIndex]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [thread, pendingUser]);

  function toggleSidebar() {
    setSidebarOpen((o) => {
      window.localStorage.setItem("matchr:sidebar", o ? "closed" : "open");
      return !o;
    });
  }

  function updateRunInThread(patch: Partial<RunView> & { id: number }) {
    setThread((t) => t.map((r) => (r.id === patch.id ? { ...r, ...patch } : r)));
  }

  /** Drijft een run stap voor stap tot hij klaar is. Werkt ook voor het hervatten van een afgebroken run. */
  const drive = useCallback(
    async (runId: number) => {
      activeRun.current = runId;
      setBusy(true);
      try {
        let status = "profile";
        let guard = 0;
        while (status !== "done" && status !== "failed" && guard++ < 60) {
          status = await runStep(runId, (ev) => {
            if (ev.type === "steps") updateRunInThread({ id: runId, state: { ...(thread.find((r) => r.id === runId)?.state ?? { steps: [] }), steps: ev.steps } });
            if (ev.type === "status") updateRunInThread({ id: runId, status: ev.status, state: ev.state });
            if (ev.type === "run" && ev.run) updateRunInThread(ev.run);
            if (ev.type === "error") setError(ev.message);
          });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Er ging iets mis.");
      } finally {
        activeRun.current = null;
        setBusy(false);
        void refreshIndex();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshIndex],
  );

  async function openThread(runId: number) {
    setError(null);
    try {
      const data = await fetchThread(runId);
      setThread(data.runs);
      setThreadId(data.threadId);
      const unfinished = data.runs.find((r) => r.status !== "done" && r.status !== "failed");
      if (unfinished && !busy) void drive(unfinished.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kon run niet laden.");
    }
  }

  function newRun() {
    setThread([]);
    setThreadId(null);
    setError(null);
    setPendingUser(null);
  }

  async function submit(input: { text: string; file?: File | null; profileOverride?: Partial<Profile> }) {
    if (busy) return;
    setError(null);
    const attachment = input.file ? { name: input.file.name, size: input.file.size } : undefined;
    setPendingUser({ text: input.text, attachment });
    try {
      const created = await createRun({ text: input.text, file: input.file, threadId: threadId ?? undefined, profileOverride: input.profileOverride });
      const data = await fetchThread(created.runId);
      setPendingUser(null);
      setThread(data.runs);
      setThreadId(data.threadId);
      if (created.status !== "done") await drive(created.runId);
      else void refreshIndex();
    } catch (e) {
      setPendingUser(null);
      setError(e instanceof Error ? e.message : "Er ging iets mis.");
    }
  }

  const latest = thread[thread.length - 1];

  return (
    <div className="min-h-screen flex flex-col">
      <Topbar onNewRun={newRun} onToggleSidebar={toggleSidebar} sidebarOpen={sidebarOpen} />
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        <main className="flex-1 flex flex-col min-w-0">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4">
            <div className="mx-auto w-full max-w-[760px] py-8">
              {thread.length === 0 && !pendingUser && <EmptyState />}
              <Thread runs={thread} pendingUser={pendingUser} onFollowup={(text) => submit({ text })} onEditProfile={(patch) => submit({ text: "Parameters aangepast", profileOverride: patch })} />
              {error && <p className="mt-4 text-sm text-err">{error}</p>}
            </div>
          </div>
          <Composer busy={busy} followup={Boolean(latest?.profile)} onSubmit={(text, file) => submit({ text, file })} />
        </main>
        {sidebarOpen && <Sidebar index={index} me={me} activeThreadId={threadId} onOpen={openThread} />}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center text-ink-soft mt-24">
      <p className="text-lg font-medium text-ink">Laad een cv op en zeg wat je zoekt.</p>
      <p className="mt-2 text-sm">Matchr zoekt op jobboards en rechtstreeks op de websites van bedrijven die bij het profiel passen.</p>
    </div>
  );
}
