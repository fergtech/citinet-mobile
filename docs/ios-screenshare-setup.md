# iOS screen share setup

LiveKit's iOS screen share needs a **Broadcast Upload Extension** — a second
app target that captures the whole device screen via ReplayKit, independent
of the app's own process. Without it, `setScreenShareEnabled(true)` opens the
system picker but publishes an empty track (0 frames) — exactly what we saw
in testing (`framesEncoded: 0`, `packetsSent: 0` on the video track).

## What's needed

1. A new Xcode target, type **Broadcast Upload Extension**.
2. An **App Group** shared by the main app and the extension (e.g.
   `group.com.fergtech.citinetmobile.broadcast`) — how the extension hands
   captured frames to the LiveKit SDK running in the main app.
3. `SampleHandler.swift` in the extension target, subclassing
   `RPBroadcastSampleHandler`. Use the sample referenced in
   `node_modules/@livekit/react-native/README.md` ("Screenshare" section) —
   the ReplayKit interface is generic, not framework-specific, so any
   RPBroadcastSampleHandler sample (LiveKit's, Jitsi's) works the same way.
4. `ScreenCapturePickerView` wired into the native call UI — triggers the
   system broadcast picker and, once the user selects your extension, calls
   `room.localParticipant.setScreenShareEnabled(true)`.

## How to do it (no local Xcode needed)

This project has no committed `ios/` folder — EAS Build generates it fresh
per build. Do this as a **local Expo config plugin**, not a manual Xcode
edit, so EAS applies it automatically on every cloud build.

1. Create `plugins/withScreenShareExtension.js` using `@expo/config-plugins`:
   - `withXcodeProject` — add a target of type
     `com.apple.product-type.app-extension` with the broadcast extension's
     `Info.plist`/entitlements shape.
   - `withDangerousMod('ios', ...)` — copy `SampleHandler.swift` + the
     extension's `Info.plist` into `ios/BroadcastExtension/` before the
     Xcode project is written out.
   - `withEntitlementsPlist` (called for **both** the main app and the
     extension) — add the shared App Group entitlement to each.
2. Register the plugin in `app.json`'s `plugins` array:
   `"./plugins/withScreenShareExtension.js"`.
3. In `components/comms/in-call-overlay.tsx` (native only — the `.web.tsx`
   variant already works via the browser's own `getDisplayMedia()`, no
   changes needed there): render `<ScreenCapturePickerView ref={...} />`
   off-screen, and change the Share button's `onPress` to call
   `NativeModules.ScreenCapturePickerViewManager.show(findNodeHandle(ref.current))`
   *before* `setScreenShareEnabled(true)` — exact call shape is in
   `node_modules/@livekit/react-native/README.md`.
4. Give the extension its own bundle ID —
   `com.fergtech.citinetmobile.BroadcastExtension` — and register it as a
   second App ID in the Apple Developer portal (same team), same flow as
   registering `com.fergtech.citinetmobile` itself.
5. Rebuild: `eas build --profile development --platform ios`. The plugin
   runs automatically as part of that build.

## Verify

Tapping Share should open iOS's system broadcast picker showing your
extension by name (not just generic "Screen Broadcast"). Selecting it should
produce `framesEncoded > 0` in the same webrtc stats log used to diagnose
this originally.

## Recommended pairing

Per the LiveKit README: combine this with `react-native-callkeep` (CallKit
registration) plus the `voip` background mode (already declared in
`app.json`) — iOS throttles background screen capture aggressively unless
the process is registered as an active VoIP call via CallKit.
