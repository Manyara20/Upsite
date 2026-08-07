import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { cookies } from "next/headers";

/**
 * The password gate for secure monitors.
 *
 * Keeping with the no-database rule, there is no user table and no session
 * store: unlocking mints a short-lived HMAC-signed token that the browser holds
 * in an httpOnly cookie, and verification is a pure function of that token plus
 * the server secret. Nothing is persisted.
 */

export const SECURE_COOKIE = "upsite_secure";

/** Sessions are deliberately short — this guards a dashboard, not a bank. */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * A per-process fallback secret. Regenerating it on restart invalidates every
 * outstanding session, which is the correct failure mode when no secret has
 * been configured — far better than a predictable default that would let anyone
 * forge a token.
 */
const EPHEMERAL_SECRET = randomBytes(32).toString("hex");

function secret(): string {
  return process.env.UPSITE_SECRET ?? EPHEMERAL_SECRET;
}

/** Whether a password has been configured at all. */
export function isSecureConfigured(): boolean {
  return Boolean(process.env.UPSITE_SECURE_PASSWORD);
}

/**
 * Constant-time password comparison. Both sides are hashed first so the
 * comparison length never varies with the input, which would otherwise leak
 * the password length through timing.
 */
export function checkPassword(input: string): boolean {
  const expected = process.env.UPSITE_SECURE_PASSWORD;
  if (!expected) return false;

  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** Mints a token of the form `<expiry>.<hmac>`. */
export function createToken(): string {
  const expiry = String(Date.now() + SESSION_TTL_MS);
  return `${expiry}.${sign(expiry)}`;
}

export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;

  const [expiry, signature] = token.split(".");
  if (!expiry || !signature) return false;

  const expected = sign(expiry);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  // Only trust the expiry after the signature proves we wrote it.
  return Number(expiry) > Date.now();
}

/**
 * Server-component / route-handler check. A caller is unlocked only when a
 * password is configured *and* it presents a valid token — so removing the
 * password from the environment locks everything back down immediately.
 */
export async function isUnlocked(): Promise<boolean> {
  if (!isSecureConfigured()) return false;
  const store = await cookies();
  return verifyToken(store.get(SECURE_COOKIE)?.value);
}

/** Same check for a raw Request, used by the SSE and badge routes. */
export function isUnlockedRequest(request: Request): boolean {
  if (!isSecureConfigured()) return false;

  const header = request.headers.get("cookie");
  if (!header) return false;

  const match = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SECURE_COOKIE}=`));

  return verifyToken(match?.slice(SECURE_COOKIE.length + 1));
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_TTL_MS / 1000,
  // Opt-in, because Upsite is commonly run over plain HTTP on a private
  // network, where a Secure cookie would simply never be sent back.
  secure: process.env.UPSITE_COOKIE_SECURE === "1",
};
