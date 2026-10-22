"use client";

import { useRef, useState } from "react";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Composer({ busy, followup, onSubmit }: { busy: boolean; followup: boolean; onSubmit: (text: string, file: File | null) => void }) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function pick(f: File | null | undefined) {
    if (!f) return;
    if (!/\.(pdf|docx|txt)$/i.test(f.name)) return;
    setFile(f);
  }

  function submit() {
    if (busy) return;
    if (!text.trim() && !file) return;
    onSubmit(text.trim(), file);
    setText("");
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <div className="shrink-0 border-t border-line bg-paper px-4 py-3">
      <div className="mx-auto w-full max-w-[760px]">
        <div
          className={`relative border rounded-xl bg-paper ${dragging ? "border-accent bg-accent-soft" : "border-line"}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer.files?.[0]);
          }}
        >
          {file && (
            <div className="flex items-center gap-2 px-3 pt-3 text-sm">
              <span className="inline-flex items-center gap-2 bg-paper-soft border border-line rounded-md px-2 py-1">
                <span className="truncate max-w-[260px]">{file.name}</span>
                <span className="text-ink-faint">{formatSize(file.size)}</span>
                <button type="button" aria-label="Bijlage verwijderen" onClick={() => setFile(null)} className="text-ink-faint hover:text-ink">
                  ×
                </button>
              </span>
            </div>
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={3}
            placeholder={followup ? "Stel een vervolgvraag of verfijn de zoektocht…" : "Sleep een cv hierin of typ wat je zoekt…"}
            className="w-full resize-none bg-transparent px-3 py-3 pr-24 focus:outline-none"
          />
          <div className="absolute right-2 bottom-2 flex items-center gap-1">
            <input ref={fileInput} type="file" accept=".pdf,.docx,.txt" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
            <button type="button" aria-label="Cv toevoegen" onClick={() => fileInput.current?.click()} className="w-9 h-9 rounded-md flex items-center justify-center text-ink-soft hover:bg-paper-soft">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M21 11.5 12.5 20a5.5 5.5 0 0 1-7.8-7.8l9-9a3.5 3.5 0 0 1 5 5l-9 9a1.5 1.5 0 0 1-2.1-2.1l8.3-8.3" />
              </svg>
            </button>
            <button type="button" aria-label="Verzenden" onClick={submit} disabled={busy || (!text.trim() && !file)} className="w-9 h-9 rounded-md bg-accent text-white flex items-center justify-center disabled:opacity-40">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-ink-faint">Een run duurt 2 tot 5 minuten. Je ziet elke stap terwijl Matchr zoekt.</p>
      </div>
    </div>
  );
}
