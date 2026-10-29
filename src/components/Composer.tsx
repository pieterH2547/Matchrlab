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
  const [region, setRegion] = useState("");
  const [radius, setRadius] = useState("30");
  const fileInput = useRef<HTMLInputElement>(null);

  function pick(f: File | null | undefined) {
    if (!f) return;
    if (!/\.(pdf|docx|txt)$/i.test(f.name)) return;
    setFile(f);
  }

  function submit() {
    if (busy) return;
    if (!text.trim() && !file) return;
    // Regio vooraf ingevuld: als eerste regel meegeven, de vrije tekst gaat altijd voor op het cv.
    const prefix = region.trim() ? `Regio: ${region.trim()}, straal ${radius} km.` : "";
    onSubmit([prefix, text.trim()].filter(Boolean).join("\n"), file);
    setText("");
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <div className="shrink-0 bg-paper px-4 pt-2 pb-4">
      <div className="mx-auto w-full max-w-[760px]">
        <div
          className={`relative border rounded-2xl bg-paper shadow-[0_1px_2px_rgba(27,24,69,0.04),0_8px_24px_rgba(27,24,69,0.05)] ${dragging ? "border-navy bg-accent-soft" : "border-line"}`}
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
            placeholder={followup ? "Stel een vervolgvraag, of sleep een nieuw cv voor een nieuwe zoektocht…" : "Sleep een cv hierin of typ wat je zoekt…"}
            className="w-full resize-none bg-transparent px-3 py-3 pr-24 focus:outline-none"
          />
          <div className="absolute right-2 bottom-2 flex items-center gap-1">
            <input ref={fileInput} type="file" accept=".pdf,.docx,.txt" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
            <button type="button" aria-label="Cv toevoegen" onClick={() => fileInput.current?.click()} className="w-9 h-9 rounded-md flex items-center justify-center text-ink-soft hover:bg-paper-soft">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M21 11.5 12.5 20a5.5 5.5 0 0 1-7.8-7.8l9-9a3.5 3.5 0 0 1 5 5l-9 9a1.5 1.5 0 0 1-2.1-2.1l8.3-8.3" />
              </svg>
            </button>
            <button type="button" aria-label="Verzenden" onClick={submit} disabled={busy || (!text.trim() && !file)} className="w-9 h-9 rounded-full bg-navy text-white flex items-center justify-center disabled:bg-line disabled:text-ink-faint">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
        </div>
        <div className="mt-2 px-1 flex flex-wrap items-center gap-3 text-xs text-ink-faint">
          <label className="inline-flex items-center gap-2">
            <span>Regio</span>
            <input
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="uit het cv, of bv. Mechelen"
              className="w-44 bg-transparent border-b border-line px-1 py-0.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-navy"
            />
          </label>
          <label className="inline-flex items-center gap-2">
            <span>straal</span>
            <select value={radius} onChange={(e) => setRadius(e.target.value)} className="bg-transparent border-b border-line px-1 py-0.5 text-sm text-ink focus:outline-none focus:border-navy">
              {["10", "20", "30", "40", "50"].map((r) => (
                <option key={r} value={r}>
                  {r} km
                </option>
              ))}
            </select>
          </label>
          <span className="ml-auto">1 tot 3 minuten per run</span>
        </div>
      </div>
    </div>
  );
}
