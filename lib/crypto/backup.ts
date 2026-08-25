import { argon2idAsync } from '@noble/hashes/argon2.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { gcm } from '@noble/ciphers/aes.js';
import * as ExpoCrypto from 'expo-crypto';

import { base64ToBytes, bytesToBase64, EcPrivateJwk, AesJwk } from './jwk';

export type KeyBackupPayload = { encrypted_payload: string; salt: string; iv: string };
export type BackedUpKeys = { ecdh_private: EcPrivateJwk; content_key: AesJwk };

// Matches citinet's ARGON2ID_PARAMS exactly (OWASP's Argon2id minimum
// baseline: m=19MiB, t=2, p=1) — version pinned explicitly rather than left
// to the library default, since a version mismatch (0x10 vs 0x13) fails
// exactly like a wrong passphrase would: no error, just garbage key material.
const ARGON2ID_PARAMS = { t: 2, m: 19_456, p: 1, version: 0x13, dkLen: 32 } as const;

// Pre-2026-08-05 backups were wrapped with PBKDF2, not Argon2id. Tried only
// as a decrypt-side fallback; every backup this app creates uses Argon2id.
const PBKDF2_ITERATIONS = 310_000;

// Pure-JS Argon2id at this memory cost is genuinely slow on a phone's JS
// engine (no native/SIMD acceleration like a real device would get) —
// realistically several seconds to over a minute depending on the device.
// `onProgress` (0..1, from @noble/hashes' own block-count tracking) lets
// callers show real progress instead of a bare spinner that looks hung.
async function deriveWrappingKeyArgon2id(
  passphrase: string,
  salt: Uint8Array,
  onProgress?: (fraction: number) => void
): Promise<Uint8Array> {
  return argon2idAsync(passphrase, salt, { ...ARGON2ID_PARAMS, onProgress });
}

async function deriveWrappingKeyLegacyPbkdf2(passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
  return pbkdf2Async(sha256, passphrase, salt, { c: PBKDF2_ITERATIONS, dkLen: 32 });
}

/** Encrypts both keys under a passphrase-derived key, ready to POST to /api/keys/backup. */
export async function wrapBackup(
  passphrase: string,
  keys: BackedUpKeys,
  onProgress?: (fraction: number) => void
): Promise<KeyBackupPayload> {
  const salt = ExpoCrypto.getRandomValues(new Uint8Array(16));
  const iv = ExpoCrypto.getRandomValues(new Uint8Array(12));
  const wrappingKey = await deriveWrappingKeyArgon2id(passphrase, salt, onProgress);
  const plaintext = new TextEncoder().encode(JSON.stringify(keys));
  const ct = gcm(wrappingKey, iv).encrypt(plaintext);
  return { encrypted_payload: bytesToBase64(ct), salt: bytesToBase64(salt), iv: bytesToBase64(iv) };
}

/**
 * Decrypts a server-stored backup with a passphrase. Tries Argon2id first,
 * then the legacy PBKDF2 format. Returns null (not a throw) on wrong
 * passphrase / corrupt backup / a format neither derivation recognizes —
 * this is an expected outcome the caller prompts the user to retry on, not
 * an error condition. `onProgress` only fires for the Argon2id attempt (the
 * slow one — legacy PBKDF2 backups are rare and its progress isn't exposed
 * by this library the same way).
 */
export async function unwrapBackup(
  backup: KeyBackupPayload,
  passphrase: string,
  onProgress?: (fraction: number) => void
): Promise<BackedUpKeys | null> {
  const salt = base64ToBytes(backup.salt);
  const iv = base64ToBytes(backup.iv);
  const ct = base64ToBytes(backup.encrypted_payload);

  for (const deriveWrappingKey of [
    (p: string, s: Uint8Array) => deriveWrappingKeyArgon2id(p, s, onProgress),
    deriveWrappingKeyLegacyPbkdf2,
  ]) {
    try {
      const wrappingKey = await deriveWrappingKey(passphrase, salt);
      const plain = gcm(wrappingKey, iv).decrypt(ct);
      return JSON.parse(new TextDecoder().decode(plain)) as BackedUpKeys;
    } catch {
      // wrong derivation format (or genuinely wrong passphrase) — try the next one.
    }
  }
  return null;
}
