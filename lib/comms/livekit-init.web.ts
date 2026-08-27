// Web counterpart of livekit-init.ts (Metro picks this automatically for
// the web bundle). registerGlobals() is RN-only setup for react-native-
// webrtc's native modules — browsers already have real, native WebRTC, so
// there's nothing to register here. This file exists purely so the bare
// `import '@/lib/comms/livekit-init'` in app/_layout.tsx never resolves to
// the native file on web, which would try to import '@livekit/react-native'
// (and transitively '@livekit/react-native-webrtc', a native-only package
// with no web build) and fail to bundle.
export {};
