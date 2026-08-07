import { NextResponse } from "next/server";
import { isUnlocked } from "@/lib/auth";
import { ensureEngine } from "@/lib/engine";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Full platform snapshot. The dashboard's initial paint comes from here. */
export async function GET() {
  await ensureEngine();

  return NextResponse.json(store.snapshot({ includeSecure: await isUnlocked() }), {
    headers: { "cache-control": "no-store" },
  });
}
