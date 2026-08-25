import { gcm } from '@noble/ciphers/aes.js';
import * as ExpoCrypto from 'expo-crypto';

import { isEncryptedBody } from '@/lib/ui/encrypted-message';
import { base64ToBytes, bytesToBase64 } from './jwk';

export { isEncryptedBody };

/**
 * Encrypts plaintext into citinet's `{"_citinet_enc":1,"ct":...,"iv":...}`
 * sentinel envelope — the exact shape `isEncryptedBody` detects and citinet's
 * own clients decrypt. `key` must be 32 bytes (AES-256).
 */
export function encryptEnvelope(key: Uint8Array, plaintext: string): string {
  const iv = ExpoCrypto.getRandomValues(new Uint8Array(12));
  const ct = gcm(key, iv).encrypt(new TextEncoder().encode(plaintext));
  return JSON.stringify({ _citinet_enc: 1, ct: bytesToBase64(ct), iv: bytesToBase64(iv) });
}

/**
 * Decrypts a `{"_citinet_enc":1,...}` envelope. Throws (auth-tag mismatch,
 * wrong key, or malformed envelope) rather than returning garbage — callers
 * must catch this and show a distinct "couldn't decrypt" state, not conflate
 * it with "still resolving keys".
 */
export function decryptEnvelope(key: Uint8Array, body: string): string {
  const { ct, iv } = JSON.parse(body) as { ct: string; iv: string };
  const plain = gcm(key, base64ToBytes(iv)).decrypt(base64ToBytes(ct));
  return new TextDecoder().decode(plain);
}
