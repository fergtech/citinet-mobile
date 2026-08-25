import { sessionStorage } from '@/lib/session/storage';
import { base64ToBytes, bytesToBase64 } from './jwk';

export type LocalIdentityKeys = {
  /** 32-byte P-256 private scalar. */
  ecdhSecretKey: Uint8Array;
  /** 65-byte uncompressed SEC1 public key. */
  ecdhPublicKey: Uint8Array;
  /** 32-byte AES-256 content key (Notes/private Files — see e2e-context.tsx's encryptNote/decryptNote). */
  contentKey: Uint8Array;
};

// expo-secure-store keys are restricted to [A-Za-z0-9._-] on native (SecureStore
// throws otherwise) — `:` isn't allowed, so this can't reuse the `hub:slug:id`
// style separators used elsewhere.
function storageKey(hubSlug: string, userId: string): string {
  return `e2e-keys.${hubSlug}.${userId}`;
}

export async function loadLocalKeys(hubSlug: string, userId: string): Promise<LocalIdentityKeys | null> {
  const raw = await sessionStorage.getItem(storageKey(hubSlug, userId));
  if (!raw) return null;
  const parsed = JSON.parse(raw) as { ecdhSecretKey: string; ecdhPublicKey: string; contentKey: string };
  return {
    ecdhSecretKey: base64ToBytes(parsed.ecdhSecretKey),
    ecdhPublicKey: base64ToBytes(parsed.ecdhPublicKey),
    contentKey: base64ToBytes(parsed.contentKey),
  };
}

export async function saveLocalKeys(hubSlug: string, userId: string, keys: LocalIdentityKeys): Promise<void> {
  const payload = JSON.stringify({
    ecdhSecretKey: bytesToBase64(keys.ecdhSecretKey),
    ecdhPublicKey: bytesToBase64(keys.ecdhPublicKey),
    contentKey: bytesToBase64(keys.contentKey),
  });
  await sessionStorage.setItem(storageKey(hubSlug, userId), payload);
}

export async function clearLocalKeys(hubSlug: string, userId: string): Promise<void> {
  await sessionStorage.deleteItem(storageKey(hubSlug, userId));
}
