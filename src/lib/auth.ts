import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { getConfig } from "./config";

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

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * The configured password, as a sha256 digest, from the first source that has
 * one. The environment always wins, so a deployment can override whatever is
 * committed to the config file.
 */
function expectedDigest(): Buffer | null {
  const fromEnv = process.env.UPSITE_SECURE_PASSWORD;
  if (fromEnv) return sha256(fromEnv);

  let auth;
  try {
    auth = getConfig().auth;
  } catch {
    // A malformed config must not take the gate down with it.
    return null;
  }

  if (auth.passwordHash) return Buffer.from(auth.passwordHash.toLowerCase(), "hex");

  // An unexpanded `${VAR}` means the variable was never set — treat that as
  // "no password", not as a literal password of that text.
  if (auth.password && !/^\$\{[A-Z0-9_]+\}$/i.test(auth.password)) {
    return sha256(auth.password);
  }

  return null;
}

/**
 * Key for signing session cookies. Falls back to deriving one from the
 * password so that sessions survive restarts even when `UPSITE_SECRET` is
 * unset — without it, every cold start on a serverless host would log
 * everyone out. Changing the password invalidates outstanding sessions, which
 * is the behaviour you want anyway.
 */
function secret(): string {
  if (process.env.UPSITE_SECRET) return process.env.UPSITE_SECRET;

  const digest = expectedDigest();
  if (digest) return createHash("sha256").update("upsite:session:").update(digest).digest("hex");

  return EPHEMERAL_SECRET;
}

/** Whether a password has been configured at all. */
export function isSecureConfigured(): boolean {
  return expectedDigest() !== null;
}

/**
 * Constant-time password comparison. Both sides are compared as digests so the
 * comparison length never varies with the input, which would otherwise leak
 * the password length through timing.
 */
export function checkPassword(input: string): boolean {
  const expected = expectedDigest();
  if (!expected) return false;

  const actual = sha256(input);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
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
