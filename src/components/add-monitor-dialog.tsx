"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/format";

/**
 * Adds a monitor from the UI. The submission is written straight into
 * `upsite.config.yaml` server-side and the scheduler hot-reloads, so the
 * config file stays the single source of truth — the dashboard is just a
 * friendlier way to edit it.
 */

/** Derives a url-safe id from the name, matching the config's own id rule. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

const field =
  "w-full rounded-xl border border-edge bg-abyss/70 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-signal/50 focus:outline-none";
const label = "block text-[11px] uppercase tracking-wider text-ink-faint mb-1.5";

export function AddMonitorDialog({
  canAddSecure,
  defaultSecure = false,
  onAdded,
}: {
  canAddSecure: boolean;
  defaultSecure?: boolean;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [url, setUrl] = useState("");
  const [tags, setTags] = useState("");
  const [interval, setInterval] = useState("60");
  const [secure, setSecure] = useState(defaultSecure);

  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) firstFieldRef.current?.focus();
  }, [open]);

  // Escape should close the dialog from anywhere inside it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const reset = () => {
    setName("");
    setId("");
    setIdTouched(false);
    setUrl("");
    setTags("");
    setInterval("60");
    setSecure(defaultSecure);
    setError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/monitors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: id || slugify(name),
          name: name.trim(),
          type: "http",
          url: url.trim(),
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          intervalSeconds: Number(interval) || 60,
          secure,
        }),
      });

      if (res.ok) {
        reset();
        setOpen(false);
        onAdded();
        return;
      }

      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Could not add the monitor");
    } catch {
      setError("Network error — is the server still running?");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-signal/40 bg-signal/10 px-3 py-1 text-[11px] text-signal transition hover:bg-signal/20"
      >
        <Plus className="h-3 w-3" />
        Add monitor
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-void/80 p-4 backdrop-blur-sm sm:p-10"
            onClick={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="add-monitor-title"
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="glass bevel w-full max-w-lg rounded-2xl border border-edge-bright p-6 shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 id="add-monitor-title" className="text-base font-medium text-ink">
                    Add monitor
                  </h2>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    Written to upsite.config.yaml and checked immediately
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="rounded-lg p-1.5 text-ink-faint transition hover:bg-edge hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={submit} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="m-name" className={label}>
                    Name
                  </label>
                  <input
                    id="m-name"
                    ref={firstFieldRef}
                    required
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (!idTouched) setId(slugify(e.target.value));
                    }}
                    placeholder="My API"
                    className={field}
                  />
                </div>

                <div>
                  <label htmlFor="m-url" className={label}>
                    URL
                  </label>
                  <input
                    id="m-url"
                    required
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://example.com"
                    className={cn(field, "font-mono text-xs")}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="m-id" className={label}>
                      ID
                    </label>
                    <input
                      id="m-id"
                      required
                      value={id}
                      onChange={(e) => {
                        setIdTouched(true);
                        setId(slugify(e.target.value));
                      }}
                      placeholder="my-api"
                      className={cn(field, "font-mono text-xs")}
                    />
                  </div>
                  <div>
                    <label htmlFor="m-interval" className={label}>
                      Interval (seconds)
                    </label>
                    <input
                      id="m-interval"
                      type="number"
                      min={5}
                      value={interval}
                      onChange={(e) => setInterval(e.target.value)}
                      className={cn(field, "font-mono text-xs")}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="m-tags" className={label}>
                    Tags (comma separated)
                  </label>
                  <input
                    id="m-tags"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="prod, api"
                    className={field}
                  />
                </div>

                {canAddSecure && (
                  <label className="flex items-start gap-2.5 rounded-xl border border-edge bg-abyss/50 p-3">
                    <input
                      type="checkbox"
                      checked={secure}
                      onChange={(e) => setSecure(e.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 accent-cyan-400"
                    />
                    <span className="text-xs text-ink-dim">
                      <span className="text-ink">Secure monitor</span> — hidden behind the
                      password gate and excluded from the public dashboard and badges.
                    </span>
                  </label>
                )}

                {error && (
                  <p role="alert" className="text-xs text-down">
                    {error}
                  </p>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-xl border border-edge px-4 py-2 text-xs text-ink-dim transition hover:text-ink"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-xl border border-signal/40 bg-signal/10 px-4 py-2 text-xs font-medium text-signal transition hover:bg-signal/20 disabled:opacity-40"
                  >
                    {busy ? "Adding…" : "Add monitor"}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
