import { registerGlobals } from '@livekit/react-native';

// Must run once, before any LiveKit connection is made — sets up the WebRTC
// globals, audio session management, and RN-specific polyfills the SDK
// needs. Imported for its side effect only, at the very top of
// app/_layout.tsx (same pattern as lib/crypto/random-polyfill.ts).
//
// This is the one place in this app that requires a native dev-client build
// (expo run:ios / expo run:android, or an EAS "development" build —
// eas.json already has that profile) instead of plain Expo Go: @livekit/
// react-native-webrtc ships real native modules Expo Go's fixed binary
// doesn't include. Every other screen in this app is unaffected; this is
// additive, not a replacement for the existing dev workflow.
registerGlobals();
