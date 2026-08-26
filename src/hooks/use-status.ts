"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSummary, type Source } from "@/lib/source";
import type { StatusSnapshot } from "@/lib/types";

export type Connection = "connecting" | "live" | "stale" | "offline";

/**
 * Checks land every 5 minutes, and anonymous GitHub API calls are capped at 60
 * an hour per IP. Polling every two minutes stays comfortably inside that even
 * with a monitor page open in another tab, and still shows a new check within
 * about as long as it took to run.
 */
const POLL_MS = 120_000;

/** Past this, the data on screen is older than the cadence promises. */
const STALE_MS = 11 * 60_000;

/**
 * Keeps the baked-in snapshot up to date by re-reading `api/summary.json` from
 * the repository.
 *
 * There is no server to stream from any more, so this polls — but the data it
 * polls only changes every five minutes, and a poll that fails leaves the last
 * good snapshot on screen rather than blanking the page.
 */
export function useStatus(initial: StatusSnapshot, source: Source) {
  const [snapshot, setSnapshot] = useState(initial);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setRefreshing(true);

    try {
      const next = await fetchSummary(source, controller.signal);
      setSnapshot(next);
      setConnection(Date.now() - next.generatedAt > STALE_MS ? "stale" : "live");
    } catch {
      if (!controller.signal.aborted) setConnection("offline");
    } finally {
      if (!controller.signal.aborted) setRefreshing(false);
    }
  }, [source]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);

    // A backgrounded tab's timers are throttled hard, so catch up on return
    // rather than showing an hour-old fleet as though it were current.
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      inFlight.current?.abort();
    };
  }, [refresh]);

  return { snapshot, connection, refresh, refreshing };
}
