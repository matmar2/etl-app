// Minimal RFC-6238 TOTP for OFFLINE MFA verification — self-contained base32 +
// HMAC-SHA1, no native crypto and no extra dependency. Used only when the server is
// unreachable; online login still verifies on the server.

function base32Decode(b32: string): number[] {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = (b32 || '').replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = 0, val = 0;
  const out: number[] = [];
  for (const c of clean) {
    const idx = A.indexOf(c);
    if (idx < 0) continue;
    val = (val << 5) | idx; bits += 5;
    if (bits >= 8) { bits -= 8; out.push((val >>> bits) & 0xff); }
  }
  return out;
}

function sha1(msg: number[]): number[] {
  const rotl = (n: number, s: number) => ((n << s) | (n >>> (32 - s))) >>> 0;
  const m = msg.slice();
  const ml = msg.length * 8;
  m.push(0x80);
  while (m.length % 64 !== 56) m.push(0);
  for (let i = 7; i >= 0; i--) m.push(Math.floor(ml / Math.pow(2, i * 8)) & 0xff);
  let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
  for (let i = 0; i < m.length; i += 64) {
    const w = new Array(80);
    for (let j = 0; j < 16; j++) w[j] = ((m[i + j * 4] << 24) | (m[i + j * 4 + 1] << 16) | (m[i + j * 4 + 2] << 8) | m[i + j * 4 + 3]) >>> 0;
    for (let j = 16; j < 80; j++) w[j] = rotl(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let j = 0; j < 80; j++) {
      let f: number, k: number;
      if (j < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
      else if (j < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
      else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
      else { f = b ^ c ^ d; k = 0xCA62C1D6; }
      const t = (rotl(a, 5) + f + e + k + w[j]) >>> 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  const out: number[] = [];
  [h0, h1, h2, h3, h4].forEach((h) => out.push((h >>> 24) & 0xff, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff));
  return out;
}

function hmacSha1(key: number[], msg: number[]): number[] {
  let k = key.slice();
  if (k.length > 64) k = sha1(k);
  while (k.length < 64) k.push(0);
  return sha1(k.map((b) => b ^ 0x5c).concat(sha1(k.map((b) => b ^ 0x36).concat(msg))));
}

function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const msg: number[] = [];
  for (let i = 7; i >= 0; i--) msg.push(Math.floor(counter / Math.pow(2, i * 8)) & 0xff);
  const h = hmacSha1(key, msg);
  const o = h[19] & 0xf;
  const bin = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return (bin % 1000000).toString().padStart(6, '0');
}

// Current 6-digit TOTP for the secret — used only to authenticate a queued offline
// password reset to the server once back online (the user already proved possession of
// the authenticator by typing a live code at reset time).
export function generateTotp(secret: string): string {
  return hotp(secret, Math.floor(Date.now() / 1000 / 30));
}

// Verify a 6-digit code against the secret, allowing ±`window` 30s steps for clock drift.
export function verifyTotp(secret: string, code: string, window = 1): boolean {
  const c = (code || '').trim();
  if (!secret || !/^\d{6}$/.test(c)) return false;
  const t = Math.floor(Date.now() / 1000 / 30);
  for (let w = -window; w <= window; w++) if (hotp(secret, t + w) === c) return true;
  return false;
}

// Local password verifier (device-only, never transmitted) for offline login.
export function sha1Hex(s: string): string {
  const bytes = Array.from(new TextEncoder().encode(s));
  return sha1(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const __totpForTest = hotp;   // exported for the build-time self-check only
