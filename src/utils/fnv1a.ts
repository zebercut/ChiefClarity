/**
 * FEAT064 — FNV-1a 64-bit hash for log correlation.
 *
 * NON-CRYPTOGRAPHIC. Use only for opaque correlators (router log lines,
 * audit-log phrase IDs). NOT suitable for integrity. For cryptographic SHA-256
 * use src/utils/sha256.ts.
 *
 * Returns 16 lowercase hex chars regardless of platform — synchronous and
 * pure JS, no Node/web branch required.
 */

// FNV-1a 64-bit constants
const OFFSET_HIGH = 0xcbf29ce4;
const OFFSET_LOW = 0x84222325;
// Prime: 0x100000001b3 = (PRIME_HIGH << 32) | PRIME_LOW
const PRIME_HIGH = 0x00000100;
const PRIME_LOW = 0x000001b3;

export function fnv1a64Hex(input: string): string {
  // Represent 64-bit state as four 16-bit limbs (little-endian).
  let h0 = OFFSET_LOW & 0xffff;
  let h1 = (OFFSET_LOW >>> 16) & 0xffff;
  let h2 = OFFSET_HIGH & 0xffff;
  let h3 = (OFFSET_HIGH >>> 16) & 0xffff;

  // Prime as 16-bit limbs (only b0 and b2 are non-zero in this prime).
  const b0 = PRIME_LOW & 0xffff;        // 0x01b3
  const b1 = (PRIME_LOW >>> 16) & 0xffff; // 0x0000
  const b2 = PRIME_HIGH & 0xffff;        // 0x0100
  // b3 = 0

  const bytes = utf8Encode(input);
  for (let i = 0; i < bytes.length; i++) {
    // XOR with byte, then multiply by FNV prime mod 2^64.
    h0 = (h0 ^ bytes[i]) & 0xffff;

    // Schoolbook 64x64 → low 64 multiplication using 16-bit limbs.
    let p0 = h0 * b0;
    let p1 = h0 * b1 + h1 * b0;
    let p2 = h0 * b2 + h1 * b1 + h2 * b0;
    let p3 = /* h0*b3=0 + */ h1 * b2 + h2 * b1 + h3 * b0;

    // Propagate carries.
    let carry = (p0 >>> 16) | 0;
    p0 = p0 & 0xffff;
    p1 = p1 + carry;
    carry = Math.floor(p1 / 65536);
    p1 = p1 & 0xffff;
    p2 = p2 + carry;
    carry = Math.floor(p2 / 65536);
    p2 = p2 & 0xffff;
    p3 = p3 + carry;
    p3 = p3 & 0xffff; // discard overflow past bit 64

    h0 = p0;
    h1 = p1;
    h2 = p2;
    h3 = p3;
  }

  // Reassemble high 32 = h3:h2, low 32 = h1:h0.
  const high = ((h3 & 0xffff) << 16) | (h2 & 0xffff);
  const low = ((h1 & 0xffff) << 16) | (h0 & 0xffff);
  return (high >>> 0).toString(16).padStart(8, "0") + (low >>> 0).toString(16).padStart(8, "0");
}

function utf8Encode(s: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(s);
  }
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let codePoint = s.charCodeAt(i);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    }
  }
  return new Uint8Array(bytes);
}
