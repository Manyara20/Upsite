import { isUnlockedRequest } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { ensureEngine } from "@/lib/engine";
import { bus } from "@/lib/events";
import { store } from "@/lib/store";
import type { StreamEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Proxies and load balancers will close an idle stream; this keeps it warm. */
const HEARTBEAT_MS = 25_000;

/**
 * Server-sent events carrying every check result as it happens. This is what
 * makes the dashboard live without polling — one open connection per tab,
 * fed directly by the scheduler.
 */
export async function GET(request: Request) {
  await ensureEngine();

  const encoder = new TextEncoder();

  // Authorisation is fixed at connection time. Secure monitors are stripped
  // from every frame for a locked client — including the `hello` snapshot and
  // the per-check events that follow.
  const unlocked = isUnlockedRequest(request);
  const secureIds = new Set(
    getConfig().monitors.filter((m) => m.secure).map((m) => m.id),
  );
  const hidden = (monitorId: string) => !unlocked && secureIds.has(monitorId);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (event: StreamEvent) => {
        if (closed) return;
        if (event.type !== "hello" && hidden(event.monitorId)) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          cleanup();
        }
      };

      // Seed the client with the current state so it renders instantly, then
      // stays in sync from the incremental events that follow.
      send({ type: "hello", snapshot: store.snapshot({ includeSecure: unlocked }) });

      const unsubscribe = bus.subscribe(send);

      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          // A comment frame — valid SSE, ignored by EventSource.
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, HEARTBEAT_MS);
      heartbeat.unref?.();

      function cleanup() {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime — nothing to do.
        }
      }

      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Tells nginx not to buffer the stream into uselessness.
      "x-accel-buffering": "no",
    },
  });
}
