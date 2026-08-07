import { NextResponse } from "next/server";
import { isUnlocked } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { ensureEngine } from "@/lib/engine";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Snapshot for a single monitor, including its full retained history. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureEngine();

  const { id } = await params;
  const monitor = getConfig().monitors.find((m) => m.id === id);

  // A locked caller gets the same 404 for a secure monitor as for one that does
  // not exist — distinguishing them would confirm the monitor is there.
  if (!monitor || (monitor.secure && !(await isUnlocked()))) {
    return NextResponse.json({ error: `No monitor "${id}"` }, { status: 404 });
  }

  return NextResponse.json(store.snapshotOf(monitor), {
    headers: { "cache-control": "no-store" },
  });
}
