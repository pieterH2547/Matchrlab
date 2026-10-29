"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const adminWanted = params.get("admin") === "1";
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(adminWanted);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, password: showPassword ? password : "" }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Aanmelden mislukt.");
      return;
    }
    router.replace(adminWanted ? "/admin" : "/");
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
      {showPassword ? (
        <label className="block">
          <span className="block text-sm text-ink-soft mb-1">Teamwachtwoord {adminWanted ? "(nodig voor de instellingen)" : ""}</span>
          <input
            type="password"
            className="w-full border border-line rounded-md px-3 py-2 focus:outline-none focus:border-accent"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
      ) : (
        <button type="button" onClick={() => setShowPassword(true)} className="text-xs text-ink-faint hover:text-ink underline">
          Ik beheer de instellingen (teamwachtwoord)
        </button>
      )}
      {error && <p className="text-sm text-err">{error}</p>}
      <button type="submit" disabled={busy} className="w-full bg-accent text-white rounded-md py-2 font-medium disabled:opacity-60">
        {busy ? "Even geduld…" : "Verder"}
      </button>
      <p className="text-xs text-ink-faint">Je blijft 30 dagen aangemeld op dit toestel.</p>
    </form>
  );
}
