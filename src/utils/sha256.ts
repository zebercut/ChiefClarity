/**
 * FEAT064 — Isomorphic SHA-256 (cryptographic).
 *
 * Used for locked-zone integrity hashes (FEAT054 §5 contract for FEAT058 / FEAT070).
 * Output is byte-equal across Node and the web bundle for the same UTF-8 input.
 *
 * For non-cryptographic logging hashes use the synchronous FNV-1a helper in
 * src/utils/fnv1a.ts — never substitute one for the other.
 */

export async function sha256Hex(input: string): Promise<string> {
  const subtle = (globalThis as any)?.crypto?.subtle;
  if (subtle && typeof subtle.digest === "function") {
    const buf = new TextEncoder().encode(input);
    const hashBuf = await subtle.digest("SHA-256", buf);
    return bytesToHex(new Uint8Array(hashBuf));
  }
  // Node fallback (older Node without globalThis.crypto.subtle).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dynRequire: NodeRequire = eval("require");
  const { createHash } = dynRequire("crypto");
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}
