import { NextResponse } from "next/server";
import { isUnlocked } from "@/lib/auth";
import { appendMonitor, newMonitorSchema } from "@/lib/config-writer";
import { engine, ensureEngine } from "@/lib/engine";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Adds a monitor: validates it, writes it into `upsite.config.yaml`, and
 * hot-reloads the scheduler so it starts being checked immediately.
 */
export async function POST(request: Request) {
  await ensureEngine();

  const parsed = newMonitorSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  // Creating a hidden monitor requires already being through the gate —
  // otherwise anyone could add one and read its results from the secure tab.
  if (parsed.data.secure && !(await isUnlocked())) {
    return NextResponse.json(
      { error: "Unlock the secure tab before adding a secure monitor" },
      { status: 401 },
    );
  }

  try {
    await appendMonitor(parsed.data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 409 },
    );
  }

  await engine.reload();

  // Check it once right away so the new card is never blank.
  await engine.triggerCheck(parsed.data.id);

  return NextResponse.json(
    {
      ok: true,
      id: parsed.data.id,
      snapshot: store.snapshot({ includeSecure: await isUnlocked() }),
    },
    { status: 201 },
  );
}
