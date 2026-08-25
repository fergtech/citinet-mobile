// Standard base64 (ciphertext/salt/iv fields in citinet's wire formats) and
// base64url (JWK x/y/d/k fields, per RFC 7518) — written from scratch rather
// than relying on btoa/atob, since Hermes doesn't guarantee those globally.
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    result += B64_CHARS[b0 >> 2];
    result += B64_CHARS[((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    result += b1 === undefined ? '=' : B64_CHARS[((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    result += b2 === undefined ? '=' : B64_CHARS[b2 & 63];
  }
  return result;
}

export function base64ToBytes(input: string): Uint8Array {
  const clean = input.replace(/=+$/, '');
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const idx = B64_CHARS.indexOf(clean[i]);
    if (idx === -1) continue;
    buffer = (buffer << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(input: string): Uint8Array {
  return base64ToBytes(input.replace(/-/g, '+').replace(/_/g, '/'));
}

function assertLength(bytes: Uint8Array, expected: number, what: string): Uint8Array {
  if (bytes.length !== expected) {
    throw new Error(`${what}: expected ${expected} bytes, got ${bytes.length}`);
  }
  return bytes;
}

// ---- EC (P-256) JWK <-> raw uncompressed SEC1 bytes (0x04 || x(32) || y(32)) ----
// Deliberately no elliptic-curve math here: an uncompressed public key IS just
// the concatenated big-endian coordinates, which is also exactly what a JWK's
// x/y fields hold (RFC 7518 §6.2.1.2 — always the curve's full coordinate size,
// zero-padded). Converting between the two is pure byte-slicing.

export type EcPublicJwk = { kty: 'EC'; crv: 'P-256'; x: string; y: string; ext?: boolean };
export type EcPrivateJwk = EcPublicJwk & { d: string };

export function rawPublicKeyToJwk(raw: Uint8Array): EcPublicJwk {
  assertLength(raw, 65, 'P-256 uncompressed public key');
  if (raw[0] !== 0x04) throw new Error('Expected an uncompressed P-256 public key (0x04 prefix)');
  return {
    kty: 'EC',
    crv: 'P-256',
    x: bytesToBase64Url(raw.slice(1, 33)),
    y: bytesToBase64Url(raw.slice(33, 65)),
    ext: true,
  };
}

export function jwkToRawPublicKey(jwk: EcPublicJwk): Uint8Array {
  const x = assertLength(base64UrlToBytes(jwk.x), 32, 'JWK x coordinate');
  const y = assertLength(base64UrlToBytes(jwk.y), 32, 'JWK y coordinate');
  const out = new Uint8Array(65);
  out[0] = 0x04;
  out.set(x, 1);
  out.set(y, 33);
  return out;
}

export function rawPrivateKeyToJwk(secretKey: Uint8Array, publicKeyRaw: Uint8Array): EcPrivateJwk {
  assertLength(secretKey, 32, 'P-256 private scalar');
  return { ...rawPublicKeyToJwk(publicKeyRaw), d: bytesToBase64Url(secretKey) };
}

export function jwkToRawPrivateKey(jwk: EcPrivateJwk): Uint8Array {
  return assertLength(base64UrlToBytes(jwk.d), 32, 'JWK d (private scalar)');
}

// ---- AES-256-GCM JWK <-> raw bytes (RFC 7518 §6.4, "oct" key type) ----
// citinet's "content key" — this app never reads/writes the content it
// protects (no Notes/private-Files UI yet), but must still round-trip a
// syntactically valid JWK through the passphrase backup so the *web* client's
// notes/files keep working for this account.

export type AesJwk = { kty: 'oct'; k: string; alg: 'A256GCM'; ext?: boolean; key_ops?: string[] };

export function rawAesKeyToJwk(keyBytes: Uint8Array): AesJwk {
  assertLength(keyBytes, 32, 'AES-256 key');
  return { kty: 'oct', k: bytesToBase64Url(keyBytes), alg: 'A256GCM', ext: true, key_ops: ['encrypt', 'decrypt'] };
}

export function jwkToRawAesKey(jwk: AesJwk): Uint8Array {
  return assertLength(base64UrlToBytes(jwk.k), 32, 'JWK k (AES key)');
}
