import { NextResponse } from "next/server";
import { isUnlocked } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { engine, ensureEngine } from "@/lib/engine";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Forces a check outside the schedule — the "check now" button, and the hook
 * an external cron would call if you preferred to drive Upsite that way.
 *
 * POST /api/check           → every active monitor the caller can see
 * POST /api/check?id=<id>   → one monitor
 */
export async function POST(request: Request) {
  await ensureEngine();

  const id = new URL(request.url).searchParams.get("id") ?? undefined;
  const unlocked = await isUnlocked();

  // A locked caller must not be able to probe a secure target on demand.
  if (id) {
    const monitor = getConfig().monitors.find((m) => m.id === id);
    if (!monitor || (monitor.secure && !unlocked)) {
      return NextResponse.json({ error: `No active monitor "${id}"` }, { status: 404 });
    }
  }

  const checked = await engine.triggerCheck(id, { includeSecure: unlocked });

  if (id && checked === 0) {
    return NextResponse.json({ error: `No active monitor "${id}"` }, { status: 404 });
  }

  return NextResponse.json({
    checked,
    snapshot: store.snapshot({ includeSecure: unlocked }),
  });
}
