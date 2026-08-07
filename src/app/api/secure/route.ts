import { NextResponse } from "next/server";
import { z } from "zod";
import {
  SECURE_COOKIE,
  checkPassword,
  cookieOptions,
  createToken,
  isSecureConfigured,
  isUnlocked,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Rate limiting for unlock attempts, kept in memory — there is no database. */
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 8;

function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  entry.count++;
  return entry.count > MAX_ATTEMPTS;
}

/** Reports whether the gate is configured and whether this caller is through it. */
export async function GET() {
  return NextResponse.json(
    { configured: isSecureConfigured(), unlocked: await isUnlocked() },
    { headers: { "cache-control": "no-store" } },
  );
}

/** Unlocks the secure tab in exchange for the configured password. */
export async function POST(request: Request) {
  if (!isSecureConfigured()) {
    return NextResponse.json(
      {
        error:
          "No secure password configured. Set UPSITE_SECURE_PASSWORD and restart.",
      },
      { status: 503 },
    );
  }

  // Behind a proxy this header is the client; on a private LAN it is absent and
  // every caller shares one bucket, which is still enough to blunt guessing.
  const client =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";

  if (rateLimited(client)) {
    return NextResponse.json(
      { error: "Too many attempts. Wait a minute and try again." },
      { status: 429 },
    );
  }

  const parsed = z
    .object({ password: z.string().min(1).max(200) })
    .safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "Password required" }, { status: 400 });
  }

  if (!checkPassword(parsed.data.password)) {
    // Deliberately vague: never confirm anything about the real password.
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  attempts.delete(client);

  const response = NextResponse.json({ unlocked: true });
  response.cookies.set(SECURE_COOKIE, createToken(), cookieOptions);
  return response;
}

/** Locks the secure tab again by dropping the cookie. */
export async function DELETE() {
  const response = NextResponse.json({ unlocked: false });
  response.cookies.set(SECURE_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  return response;
}
