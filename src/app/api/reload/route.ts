import { NextResponse } from "next/server";
import { engine, ensureEngine } from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Re-reads `upsite.config.yaml` and rebuilds the schedule in place, so adding
 * a monitor does not require a restart.
 *
 * Guarded by UPSITE_ADMIN_TOKEN when that is set: send it as
 * `Authorization: Bearer <token>`. Left unset, the route is open — fine behind
 * a private network, not fine on the public internet.
 */
export async function POST(request: Request) {
  const token = process.env.UPSITE_ADMIN_TOKEN;

  if (token) {
    const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (provided !== token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  await ensureEngine();

  try {
    const config = await engine.reload();
    return NextResponse.json({
      ok: true,
      monitors: config.monitors.map((m) => ({ id: m.id, name: m.name, paused: m.paused })),
    });
  } catch (err) {
    // A malformed edit should report the validation error, not 500 blindly.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
