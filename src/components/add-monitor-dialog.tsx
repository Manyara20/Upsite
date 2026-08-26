"use client";

import { useMemo, useState } from "react";
import { Check, Copy, ExternalLink, Plus, X } from "lucide-react";
import { cn } from "@/lib/format";
import { type Source } from "@/lib/source";

/**
 * Adds a website to the fleet.
 *
 * `upsite.config.yaml` is the only source of truth and there is no server to
 * write it, so this composes the entry and hands it over — to the clipboard,
 * and to GitHub's own file editor. Committing it is what adds the monitor;
 * `summary.yml` picks it up on that push and the next 5-minute tick checks it.
 *
 * Doing it this way keeps the config reviewable in a diff, which is most of
 * the point of storing it in git at all.
 */

/** Mirrors the `id` rule in the config schema. */
const ID_PATTERN = /^[a-z0-9][a-z0-9-_]*$/i;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

/** Quotes only when YAML would otherwise misread the value. */
function yamlString(value: string): string {
  return /^[A-Za-z0-9][\w .\-/:]*$/.test(value) ? value : JSON.stringify(value);
}

export function AddMonitorDialog({ source }: { source: Source }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [tags, setTags] = useState("production");
  const [protectedMonitor, setProtectedMonitor] = useState(false);
  const [copied, setCopied] = useState(false);

  // Both default from the URL until the field is touched, so the common case
  // is paste-and-go.
  const effectiveId = id || slugify(url);
  const effectiveName =
    name || slugify(url).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const valid = (() => {
    try {
      const parsed = new URL(url);
      return (
        (parsed.protocol === "https:" || parsed.protocol === "http:") &&
        ID_PATTERN.test(effectiveId) &&
        effectiveName.length > 0
      );
    } catch {
      return false;
    }
  })();

  const snippet = useMemo(() => {
    const list = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    return [
      `  - id: ${effectiveId || "my-site"}`,
      `    name: ${yamlString(effectiveName || "My Site")}`,
      `    url: ${url || "https://example.com"}`,
      list.length > 0 ? `    tags: [${list.join(", ")}]` : null,
      protectedMonitor ? "    secure: true" : null,
    ]
      .filter(Boolean)
      .join("\n");
  }, [effectiveId, effectiveName, url, tags, protectedMonitor]);

  const editUrl = `https://github.com/${source.owner}/${source.name}/edit/${source.branch}/upsite.config.yaml`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is blocked without a secure context or permission. The
      // snippet is on screen and selectable, so this is not worth an error.
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-abyss px-3 py-1 text-[11px] text-ink-dim transition hover:border-signal/40 hover:text-signal"
      >
        <Plus className="h-3 w-3" />
        Add a website
      </button>
    );
  }

  const field =
    "mt-1.5 w-full rounded-xl border border-edge bg-abyss/70 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-signal/50 focus:outline-none";
  const label = "block text-[11px] text-ink-dim";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-monitor-title"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-void/80 p-4 backdrop-blur-sm sm:p-8"
    >
      <div className="glass bevel w-full max-w-lg rounded-2xl border border-edge p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="add-monitor-title" className="text-sm font-medium text-ink">
              Add a website
            </h2>
            <p className="mt-1 text-xs text-ink-faint">
              Monitors live in <code className="text-ink-dim">upsite.config.yaml</code>. This
              writes the entry — commit it and checking starts on the next tick.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="rounded-lg p-1 text-ink-faint transition hover:bg-edge hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <label htmlFor="add-url" className={label}>
              URL
            </label>
            <input
              id="add-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              className={field}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="add-name" className={label}>
                Display name
              </label>
              <input
                id="add-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={effectiveName || "My Site"}
                className={field}
              />
            </div>
            <div>
              <label htmlFor="add-id" className={label}>
                Id <span className="text-ink-faint">— permanent, names the data files</span>
              </label>
              <input
                id="add-id"
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder={effectiveId || "my-site"}
                aria-invalid={effectiveId.length > 0 && !ID_PATTERN.test(effectiveId)}
                className={field}
              />
            </div>
          </div>

          <div>
            <label htmlFor="add-tags" className={label}>
              Tags <span className="text-ink-faint">— comma separated</span>
            </label>
            <input
              id="add-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="production, web"
              className={field}
            />
          </div>

          <label className="flex items-start gap-2.5 text-xs text-ink-dim">
            <input
              type="checkbox"
              checked={protectedMonitor}
              onChange={(e) => setProtectedMonitor(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded border-edge bg-abyss accent-signal"
            />
            <span>
              Protected
              <span className="block text-ink-faint">
                Published encrypted and shown only in the protected tab. Needs the
                UPSITE_SECURE_KEY secret to be set.
              </span>
            </span>
          </label>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-ink-dim">Add this under `monitors:`</span>
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-2 py-1 text-[11px] text-ink-dim transition hover:border-signal/40 hover:text-signal"
            >
              {copied ? <Check className="h-3 w-3 text-up" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="mt-2 overflow-x-auto rounded-xl border border-edge bg-void/60 p-3 font-mono text-[11px] leading-relaxed text-ink-dim">
            {snippet}
          </pre>
          {url.length > 0 && !valid && (
            <p role="alert" className="mt-2 text-[11px] text-degraded">
              Enter a full http(s) URL and an id of letters, digits, hyphens or underscores.
            </p>
          )}
        </div>

        <a
          href={editUrl}
          target="_blank"
          rel="noreferrer noopener"
          onClick={() => void copy()}
          className={cn(
            "mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition",
            valid
              ? "border-signal/40 bg-signal/10 text-signal hover:bg-signal/15"
              : "pointer-events-none border-edge text-ink-faint opacity-40",
          )}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Copy and open the config on GitHub
        </a>
      </div>
    </div>
  );
}
