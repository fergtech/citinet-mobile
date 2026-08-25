import { p256 } from '@noble/curves/nist.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

export type IdentityKeyPair = {
  /** 32-byte P-256 private scalar. */
  secretKey: Uint8Array;
  /** 65-byte uncompressed SEC1 public key (0x04 || x || y). */
  publicKey: Uint8Array;
};

export function generateIdentityKeyPair(): IdentityKeyPair {
  const { secretKey } = p256.keygen();
  const publicKey = p256.getPublicKey(secretKey, false);
  return { secretKey, publicKey };
}

// citinet's fixed HKDF info string — binds the derived key to "this is a
// citinet DM key", distinct from any other use of the same ECDH shared secret.
const DM_KEY_INFO = new TextEncoder().encode('citinet-dm-v1');

/**
 * ECDH(myPriv, theirPub) -> 32-byte raw shared secret. Matches WebCrypto's
 * deriveBits({name:'ECDH'}, ...) exactly: X-coordinate only, no framing.
 * `getSharedSecret(..., true)` returns a compressed point (1-byte parity
 * prefix + 32-byte X) — the prefix byte is stripped, not just ignored, so a
 * future library default change would trip the length assert below instead
 * of silently deriving a wrong-but-valid-shaped key.
 */
function deriveSharedSecret(mySecretKey: Uint8Array, theirPublicKey: Uint8Array): Uint8Array {
  const shared = p256.getSharedSecret(mySecretKey, theirPublicKey, true).slice(1);
  if (shared.length !== 32) {
    throw new Error(`Unexpected ECDH shared-secret length: ${shared.length}`);
  }
  return shared;
}

/**
 * Per-conversation DM key: ECDH shared secret -> HKDF-SHA256(salt=conversationId,
 * info="citinet-dm-v1") -> 32-byte AES-256-GCM key. Deliberately not memoized
 * here — callers (keyManager.ts) cache this per conversationId since it
 * involves EC scalar multiplication and shouldn't run on every message.
 */
export function deriveConversationKey(
  mySecretKey: Uint8Array,
  theirPublicKey: Uint8Array,
  conversationId: string
): Uint8Array {
  const shared = deriveSharedSecret(mySecretKey, theirPublicKey);
  const salt = new TextEncoder().encode(conversationId);
  const key = hkdf(sha256, shared, salt, DM_KEY_INFO, 32);
  if (key.length !== 32) {
    throw new Error(`Unexpected derived conversation key length: ${key.length}`);
  }
  return key;
}
