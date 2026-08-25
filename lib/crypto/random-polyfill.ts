import * as ExpoCrypto from 'expo-crypto';

// @noble/curves/hashes/ciphers rely on a global crypto.getRandomValues (same as
// browser WebCrypto) for their own internal randomness (e.g. p256.keygen()).
// react-native-get-random-values would provide this too, but it's a native
// module and this project runs in plain Expo Go (no dev client) — it would
// crash. expo-crypto's getRandomValues is the Expo-Go-compatible equivalent.
//
// `globalThis.crypto` already has an ambient `Crypto` type (subtle,
// randomUUID, getRandomValues) that a minimal polyfill object can't
// structurally satisfy — this is a deliberate, isolated `any` escape for a
// low-level global shim, not a stand-in for real typing elsewhere.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalAny = globalThis as any;

if (typeof globalAny.crypto !== 'object' || globalAny.crypto === null) {
  globalAny.crypto = {};
}
if (typeof globalAny.crypto.getRandomValues !== 'function') {
  globalAny.crypto.getRandomValues = ExpoCrypto.getRandomValues;
}
