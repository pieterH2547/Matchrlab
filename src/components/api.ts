"use client";

import type { RunView, StepState, RunState, Profile } from "@/lib/pipeline/types";
import type { RunListItem } from "@/lib/runs";

export type RunsIndex = { runs: RunListItem[]; me: string; week: { runs: number; cost: number }; month: { spent: number; budget: number; braveQueries: number } };

export async function fetchIndex(): Promise<RunsIndex> {
  const res = await fetch("/api/runs", { cache: "no-store" });
  if (!res.ok) throw new Error("Kon runs niet laden.");
  return res.json();
}

export async function fetchThread(runId: number): Promise<{ threadId: string; runs: RunView[] }> {
  const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Kon run niet laden.");
  return res.json();
}

export async function createRun(input: { text: string; file?: File | null; threadId?: string; profileOverride?: Partial<Profile> }): Promise<{ runId: number; threadId: string; status: string }> {
  const form = new FormData();
  form.set("text", input.text);
  if (input.file) form.set("file", input.file);
  if (input.threadId) form.set("threadId", input.threadId);
  if (input.profileOverride) form.set("profileOverride", JSON.stringify(input.profileOverride));
  const res = await fetch("/api/runs", { method: "POST", body: form });
  const data = (await res.json().catch(() => ({}))) as { error?: string; runId: number; threadId: string; status: string };
  if (!res.ok) throw new Error(data.error ?? "Run starten mislukt.");
  return data;
}

export type StepEvent =
  | { type: "steps"; steps: StepState[] }
  | { type: "status"; status: string; state: RunState }
  | { type: "error"; message: string }
  | { type: "run"; status: string; run: RunView | null };

/** Eén stap uitvoeren en de SSE-events doorgeven. Geeft de eindstatus van de stap terug. */
export async function runStep(runId: number, onEvent: (e: StepEvent) => void): Promise<string> {
  const res = await fetch(`/api/runs/${runId}/step`, { method: "POST" });
  if (!res.ok || !res.body) throw new Error("Stap mislukt.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalStatus = "failed";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          const ev = JSON.parse(line.slice(6)) as StepEvent;
          if (ev.type === "run") finalStatus = ev.status;
          onEvent(ev);
        } catch {
          /* genegeerd */
        }
      }
    }
  }
  return finalStatus;
}
