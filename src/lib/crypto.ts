/**
 * Envelope encryption for the protected monitors, using WebCrypto — which is
 * the same API in Node 20+ and in the browser, so the workflow that seals the
 * data and the page that opens it share this file exactly.
 *
 * The problem it solves: a static site has no server, so a "protected tab"
 * whose gate is a client-side comparison protects nothing — the data it hides
 * is still a plain file anyone can request. Here the committed file *is*
 * ciphertext. The key never leaves the repository secret and the reader's
 * browser, and the gate is real because there is nothing to bypass.
 *
 * It is only ever as strong as the passphrase. A short one is brute-forceable
 * offline by anyone who clones the repo, PBKDF2 or not.
 */

const KDF_ITERATIONS = 300_000;
const SALT_BYTES = 16;
/** AES-GCM standard nonce length. Never reused under one key — see `seal`. */
const IV_BYTES = 12;

export interface Sealed {
  v: 1;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  /** base64 */
  salt: string;
  /** base64 */
  iv: string;
  /** base64 ciphertext, GCM tag included */
  data: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  // Chunked so a large payload cannot blow the argument limit on spread.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// The explicit ArrayBuffer keeps the result assignable to BufferSource: a bare
// `new Uint8Array(n)` is typed over ArrayBufferLike, which admits
// SharedArrayBuffer and so is rejected by the WebCrypto signatures.
function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function seal(plaintext: string, passphrase: string): Promise<Sealed> {
  // Fresh salt and IV on every seal. Reusing an IV under the same AES-GCM key
  // leaks the XOR of the plaintexts, so this is not an optimisation to make
  // even though it means the file changes on every publish.
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(SALT_BYTES)));
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(IV_BYTES)));
  const key = await deriveKey(passphrase, salt, KDF_ITERATIONS);

  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );

  return {
    v: 1,
    kdf: "PBKDF2-SHA256",
    iterations: KDF_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(data)),
  };
}

export class WrongKeyError extends Error {
  constructor() {
    super("That key does not open this file.");
    this.name = "WrongKeyError";
  }
}

export async function unseal(sealed: Sealed, passphrase: string): Promise<string> {
  if (sealed.v !== 1) throw new Error(`Unsupported sealed format v${sealed.v}`);

  const key = await deriveKey(
    passphrase,
    fromBase64(sealed.salt),
    // Read from the file rather than assumed, so raising the cost later does
    // not lock anyone out of data sealed before the change.
    sealed.iterations,
  );

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(sealed.iv) },
      key,
      fromBase64(sealed.data),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    // GCM authentication failed. In practice that always means a wrong key —
    // the alternative, a corrupted file, is not something a reader can act on.
    throw new WrongKeyError();
  }
}
