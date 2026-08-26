"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, Loader2, Lock, LockOpen, ShieldCheck, TriangleAlert } from "lucide-react";
import { MonitorCard } from "./monitor-card";
import { IncidentFeed } from "./incident-feed";
import { unseal, WrongKeyError } from "@/lib/crypto";
import { fetchSealed, SourceError, type Source } from "@/lib/source";
import type { StatusSnapshot } from "@/lib/types";

/**
 * The protected tab.
 *
 * `api/secure.json` is AES-GCM ciphertext, sealed by the workflow with the
 * `UPSITE_SECURE_KEY` repository secret. The key entered here derives the
 * decryption key in the browser and never leaves it. There is no gate to slip
 * past — without the key the file is noise.
 */

/** Same cadence as the public dashboard. */
const POLL_MS = 120_000;

/**
 * sessionStorage, not localStorage: the key survives a reload but not the tab
 * closing, which is the right default for something that unlocks monitoring
 * data on a machine that may not be the reader's own.
 */
const STORAGE_KEY = "upsite:protected-key";

function readStoredKey(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode, or storage disabled. Unlocking still works, it just will
    // not be remembered across a reload.
    return null;
  }
}

type State =
  | { phase: "locked"; error: string | null }
  | { phase: "unlocking" }
  | { phase: "open"; snapshot: StatusSnapshot };

export function ProtectedPanel({ source }: { source: Source }) {
  const [state, setState] = useState<State>({ phase: "locked", error: null });
  const [input, setInput] = useState("");
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(
    async (passphrase: string): Promise<string | null> => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;

      // Read through the same path as the public dashboard — this is just
      // another committed file, one that happens to be ciphertext.
      let sealed;
      try {
        sealed = await fetchSealed(source, controller.signal);
      } catch (err) {
        if (controller.signal.aborted) return null;
        if (err instanceof SourceError && err.status === 404) {
          return "No protected data has been published yet. Set the UPSITE_SECURE_KEY secret and run the Summary workflow.";
        }
        return "Could not reach GitHub.";
      }

      try {
        const snapshot = JSON.parse(await unseal(sealed, passphrase)) as StatusSnapshot;
        keyRef.current = passphrase;
        setState({ phase: "open", snapshot });
        return null;
      } catch (err) {
        return err instanceof WrongKeyError
          ? "That key does not open this file."
          : "The protected data could not be read.";
      }
    },
    [source],
  );

  const unlock = useCallback(
    async (passphrase: string, remember: boolean) => {
      if (!passphrase) return;
      setState({ phase: "unlocking" });

      const error = await load(passphrase);
      if (error === null) {
        setInput("");
        if (remember) {
          try {
            sessionStorage.setItem(STORAGE_KEY, passphrase);
          } catch {
            // Not being able to remember it is not a reason to fail the unlock.
          }
        }
        return;
      }
      setState({ phase: "locked", error });
    },
    [load],
  );

  const lock = useCallback(() => {
    inFlight.current?.abort();
    keyRef.current = null;
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing was stored; nothing to clear.
    }
    setState({ phase: "locked", error: null });
  }, []);

  // Resume an unlocked session across a reload.
  useEffect(() => {
    const stored = readStoredKey();
    if (stored) void unlock(stored, false);
    // Deliberately once, on mount: re-running this on every `unlock` identity
    // change would re-unlock immediately after an explicit lock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the protected view as fresh as the public one while it is open.
  useEffect(() => {
    if (state.phase !== "open") return;
    const timer = setInterval(() => {
      if (keyRef.current) void load(keyRef.current);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [state.phase, load]);

  useEffect(() => () => inFlight.current?.abort(), []);

  if (state.phase === "open") {
    const { snapshot } = state;

    return (
      <div className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-xs text-ink-dim">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-up" />
            Decrypted in your browser. {snapshot.monitors.length} protected monitor
            {snapshot.monitors.length === 1 ? "" : "s"}.
          </p>
          <button
            type="button"
            onClick={lock}
            className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-abyss px-3 py-1 text-[11px] text-ink-dim transition hover:border-down/40 hover:text-down"
          >
            <Lock className="h-3 w-3" />
            Lock
          </button>
        </div>

        <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {snapshot.monitors.map((monitor, i) => (
            // No detail page exists for a protected monitor — its per-monitor
            // file is never published in the clear.
            <MonitorCard key={monitor.id} monitor={monitor} index={i} href={null} />
          ))}
        </section>

        {snapshot.incidents.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-3 text-sm font-medium tracking-wide text-ink">
              Protected incident log
            </h2>
            <IncidentFeed
              incidents={snapshot.incidents}
              names={Object.fromEntries(snapshot.monitors.map((m) => [m.id, m.name]))}
            />
          </div>
        )}
      </div>
    );
  }

  const busy = state.phase === "unlocking";

  return (
    <div className="mt-6 flex justify-center">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const remember = new FormData(e.currentTarget).get("remember") === "on";
          void unlock(input, remember);
        }}
        className="glass bevel w-full max-w-md rounded-2xl border border-edge p-7"
      >
        <div className="flex items-center gap-2.5">
          <KeyRound className="h-4 w-4 text-signal" />
          <h2 className="text-sm font-medium text-ink">Protected monitors</h2>
        </div>

        <p className="mt-2 text-xs leading-relaxed text-ink-faint">
          These monitors are published as encrypted data. Your key decrypts them here in
          the browser — it is never sent anywhere.
        </p>

        <label htmlFor="protected-key" className="mt-5 block text-[11px] text-ink-dim">
          Access key
        </label>
        <input
          id="protected-key"
          name="key"
          type="password"
          autoComplete="current-password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          aria-describedby={state.phase === "locked" && state.error ? "protected-error" : undefined}
          aria-invalid={state.phase === "locked" && state.error !== null}
          className="mt-1.5 w-full rounded-xl border border-edge bg-abyss/70 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-signal/50 focus:outline-none disabled:opacity-50"
          placeholder="••••••••••••"
        />

        <label className="mt-3 flex items-center gap-2 text-[11px] text-ink-faint">
          <input
            type="checkbox"
            name="remember"
            defaultChecked
            className="h-3.5 w-3.5 rounded border-edge bg-abyss accent-signal"
          />
          Keep unlocked until this tab closes
        </label>

        {state.phase === "locked" && state.error && (
          <p
            id="protected-error"
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-lg bg-down/10 px-3 py-2 text-xs text-down"
          >
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || input.length === 0}
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-signal/40 bg-signal/10 px-4 py-2.5 text-sm text-signal transition hover:bg-signal/15 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LockOpen className="h-3.5 w-3.5" />}
          {busy ? "Decrypting…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}
