"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { KeyRound, Lock, ShieldCheck } from "lucide-react";

/**
 * The password gate for the secure tab. The form is the only thing rendered
 * while locked — the monitors behind it are never sent to the browser at all,
 * so there is nothing here to reveal with devtools.
 */
export function SecureGate({
  configured,
  onUnlocked,
}: {
  configured: boolean;
  onUnlocked: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!configured) {
    return (
      <div className="glass mx-auto mt-10 max-w-lg rounded-2xl border border-edge p-8 text-center">
        <Lock className="mx-auto h-6 w-6 text-ink-faint" />
        <h2 className="mt-4 text-base font-medium text-ink">Secure tab not configured</h2>
        <p className="mt-2 text-sm text-ink-dim">
          Set a password either way and restart the server:
        </p>

        <p className="mt-4 text-left text-[11px] uppercase tracking-wider text-ink-faint">
          In the environment
        </p>
        <pre className="mt-1.5 overflow-x-auto rounded-lg border border-edge bg-void/60 p-3 text-left font-mono text-[11px] text-ink-dim">
          {`UPSITE_SECURE_PASSWORD=your-password`}
        </pre>

        <p className="mt-4 text-left text-[11px] uppercase tracking-wider text-ink-faint">
          Or in upsite.config.yaml
        </p>
        <pre className="mt-1.5 overflow-x-auto rounded-lg border border-edge bg-void/60 p-3 text-left font-mono text-[11px] text-ink-dim">
          {`auth:
  passwordHash: <printf '%s' 'pw' | sha256sum>`}
        </pre>
        <p className="mt-2 text-left text-[11px] text-ink-faint">
          The config option survives deploys that don&apos;t carry your env file, but
          anyone who can read the repo can attack the hash offline.
        </p>
        <p className="mt-3 text-[11px] text-ink-faint">
          Secure monitors keep being checked either way — only viewing them is gated.
        </p>
      </div>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/secure", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        setPassword("");
        onUnlocked();
        return;
      }

      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Unable to unlock");
    } catch {
      setError("Network error — is the server still running?");
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="glass bevel mx-auto mt-10 max-w-md rounded-2xl border border-edge p-8"
    >
      <div className="flex items-center gap-2.5">
        <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl border border-signal/30 bg-signal/10">
          <ShieldCheck className="h-4 w-4 text-signal" />
        </span>
        <div>
          <h2 className="text-base font-medium text-ink">Secure monitors</h2>
          <p className="text-xs text-ink-faint">Password required</p>
        </div>
      </div>

      <form onSubmit={submit} className="mt-6">
        <label htmlFor="secure-password" className="sr-only">
          Password
        </label>
        <div className="relative">
          <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            id="secure-password"
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            className="w-full rounded-xl border border-edge bg-abyss/70 py-2.5 pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-signal/50 focus:outline-none"
          />
        </div>

        {error && (
          <p role="alert" className="mt-3 text-xs text-down">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || password.length === 0}
          className="mt-4 w-full rounded-xl border border-signal/40 bg-signal/10 py-2.5 text-sm font-medium text-signal transition hover:bg-signal/20 disabled:opacity-40"
        >
          {busy ? "Unlocking…" : "Unlock"}
        </button>
      </form>
    </motion.div>
  );
}
