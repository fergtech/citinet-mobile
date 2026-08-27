import { AudioSession, registerGlobals, setupIOSAudioManagement } from '@livekit/react-native';

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

// registerGlobals() alone sets up automatic iOS audio-session management
// with preferSpeakerOutput defaulting to true — that re-applies a
// speaker-preferring, far-field-tuned audio mode ('videoChat') continuously
// as the audio engine's state changes, all call long. That's a much
// stronger, more persistent lever than the one-shot AudioSession.
// configureAudio() call this used to make, and it explains two symptoms at
// once: the in-call Speaker toggle's manual AudioSession.selectAudioOutput()
// override kept getting stomped back to speaker, and forcing the far-field
// ('videoChat') acoustic profile onto a phone actually routed through its
// own loudspeaker (mic sitting right next to it) is a textbook setup for
// real acoustic feedback — which is what "hearing myself very loudly"
// actually was, not a software loopback.
//
// false here makes earpiece + the near-field 'voiceChat' profile (properly
// tuned echo cancellation for that routing) the baseline for every call.
// The in-call Speaker button's AudioSession.selectAudioOutput() call (see
// components/comms/in-call-overlay.tsx) is still what does the live
// per-call toggle — this only changes what it's fighting against.
setupIOSAudioManagement(false);
