"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, password }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Aanmelden mislukt.");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="block text-sm text-ink-soft mb-1">Jouw naam</span>
        <input
          className="w-full border border-line rounded-md px-3 py-2 focus:outline-none focus:border-accent"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          placeholder="Bv. Sofie"
          required
        />
      </label>
      <label className="block">
        <span className="block text-sm text-ink-soft mb-1">Teamwachtwoord</span>
        <input
          type="password"
          className="w-full border border-line rounded-md px-3 py-2 focus:outline-none focus:border-accent"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      {error && <p className="text-sm text-err">{error}</p>}
      <button type="submit" disabled={busy} className="w-full bg-accent text-white rounded-md py-2 font-medium disabled:opacity-60">
        {busy ? "Even geduld…" : "Aanmelden"}
      </button>
      <p className="text-xs text-ink-faint">Je blijft 30 dagen aangemeld op dit toestel.</p>
    </form>
  );
}
