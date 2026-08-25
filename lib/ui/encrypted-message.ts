// citinet's web client end-to-end encrypts DM/note bodies it can resolve a key
// for, storing them as `{"_citinet_enc":1,"ct":"...","iv":"..."}`. This cheap
// envelope check is used both to decide whether real decryption (lib/crypto/*)
// should even be attempted, and as the fallback "locked" placeholder when it
// can't be — keys aren't ready yet, or decryption genuinely fails — matching
// citinet's own graceful degradation on decrypt failure.
export function isEncryptedBody(body: string): boolean {
  if (!body.startsWith('{')) return false;
  try {
    const parsed = JSON.parse(body);
    return parsed?._citinet_enc === 1;
  } catch {
    return false;
  }
}
