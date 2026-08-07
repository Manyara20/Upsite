"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StatusSnapshot, StreamEvent } from "@/lib/types";

type Connection = "connecting" | "live" | "offline";

/**
 * Keeps a snapshot in sync with the server over SSE.
 *
 * Individual check results are merged locally — the common case, and far
 * cheaper than refetching. Status transitions also change the incident log and
 * the overall banner, so those trigger one full refetch instead of trying to
 * reproduce the store's reducer logic in the browser.
 */
export function useLiveStatus(initial: StatusSnapshot, reconnectKey: number = 0) {
  const [snapshot, setSnapshot] = useState<StatusSnapshot>(initial);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [lastEventAt, setLastEventAt] = useState<number>(initial.generatedAt);
  const sourceRef = useRef<EventSource | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (res.ok) setSnapshot((await res.json()) as StatusSnapshot);
    } catch {
      // The SSE connection is the source of truth for liveness; a failed
      // refetch will be corrected by the next `hello` on reconnect.
    }
  }, []);

  const checkAll = useCallback(async (monitorId?: string) => {
    const qs = monitorId ? `?id=${encodeURIComponent(monitorId)}` : "";
    try {
      const res = await fetch(`/api/check${qs}`, { method: "POST" });
      if (res.ok) {
        const body = (await res.json()) as { snapshot: StatusSnapshot };
        setSnapshot(body.snapshot);
      }
    } catch {
      // Non-fatal: the scheduled check will land shortly regardless.
    }
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/stream");
    sourceRef.current = source;

    source.onopen = () => setConnection("live");

    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as StreamEvent;
      setLastEventAt(Date.now());
      setConnection("live");

      if (event.type === "hello") {
        setSnapshot(event.snapshot);
        return;
      }

      if (event.type === "transition") {
        void refresh();
        return;
      }

      setSnapshot((prev) => ({
        ...prev,
        generatedAt: Date.now(),
        monitors: prev.monitors.map((m) => {
          if (m.id !== event.monitorId) return m;
          // Mirror the server's retention so a long-lived tab cannot grow
          // its recent buffer without bound.
          const recent = [...m.recent, event.result].slice(-2880);
          return { ...m, state: event.state, recent };
        }),
      }));
    };

    // EventSource reconnects on its own; reflect the gap in the UI meanwhile.
    source.onerror = () => setConnection("offline");

    return () => {
      source.close();
      sourceRef.current = null;
    };
    // The stream fixes authorisation at connection time, so unlocking the
    // secure tab has to tear the connection down and open a new one.
  }, [refresh, reconnectKey]);

  return { snapshot, connection, lastEventAt, refresh, checkAll };
}
