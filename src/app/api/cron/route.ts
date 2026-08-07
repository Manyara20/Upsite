import { NextResponse } from "next/server";
import { engine, ensureEngine } from "@/lib/engine";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron entry point for hosts where the in-process scheduler cannot run.
 *
 * It is a GET because that is what scheduled-job runners send (Vercel Cron,
 * GitHub Actions, cron-job.org, an external `curl`). Vercel sets
 * `CRON_SECRET` as an `Authorization: Bearer` header when it is configured;
 * when the variable is present we require it, so the endpoint cannot be used
 * by anyone else to trigger checks.
 */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;

  if (expected) {
    const provided = request.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "");
    if (provided !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  await ensureEngine();

  // Cron is not waiting on a page render, so give slow targets real time.
  const checked = await engine.ensureFresh({ budgetMs: 25_000 });

  return NextResponse.json({
    ok: true,
    checked,
    persistent: store.isPersistent,
    at: Date.now(),
  });
}
