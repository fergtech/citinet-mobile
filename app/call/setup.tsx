import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';

import { HubAvatar } from '@/components/hub-avatar';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { CallMode } from '@/lib/api/types';
import { useCall } from '@/lib/comms/call-context';
import { useSession } from '@/lib/session/session-context';

// Reached two ways: pushed directly from a thread's phone/video header
// button (outgoing — params carry who/what), or auto-pushed by
// app/_layout.tsx the instant an 'incoming_call' WS event flips the shared
// CallContext to phase 'incoming' (no params needed then, everything comes
// from context). Either way this screen is pure UI/state — no LiveKit SDK
// usage at all, since the self-preview tile is a static monogram-on-gradient
// per spec, not a live camera feed. The real connection only starts once
// the CTA is actually tapped (outgoing) or Answer is tapped (incoming) — see
// handleStart/answer below — at which point components/comms/in-call-
// overlay.tsx takes over and this screen pops itself.
export default function CallSetupScreen() {
  const { session } = useSession();
  const params = useLocalSearchParams<{ conversationId?: string; peerId?: string; peerName?: string; mode?: string }>();
  const { call, startOutgoingCall, answer, decline, reset, toggleMic, toggleCam, toggleBlur, toggleSpeaker } = useCall();

  const isIncoming = call.phase === 'incoming';
  const outgoingParamsReady = !!(params.conversationId && params.peerId && params.peerName);
  // Local, not context state — nothing about "which mode" exists in
  // CallContext until startOutgoingCall actually rings (that's what makes
  // it real). "Switch to audio only"/"Turn on video" below just flips this.
  const [localMode, setLocalMode] = useState<CallMode>(params.mode === 'audio' ? 'audio' : 'video');

  // Only meaningful for the incoming path — an outgoing call already pops
  // this screen synchronously in handleStart, before 'connected' is ever
  // reached while this screen is still mounted.
  useEffect(() => {
    if (call.phase === 'connected') {
      router.back();
    } else if (call.phase === 'ended') {
      const timer = setTimeout(() => {
        reset();
        router.back();
      }, 900);
      return () => clearTimeout(timer);
    }
  }, [call.phase, reset]);

  function handleStart() {
    if (!outgoingParamsReady) return;
    startOutgoingCall({
      conversationId: params.conversationId!,
      peerId: params.peerId!,
      peerName: params.peerName!,
      mode: localMode,
    });
    // Phase flips to 'outgoing' synchronously above — the overlay picks it
    // up the instant this screen is gone, no need to wait on the ring
    // request's own network round trip.
    router.back();
  }

  function handleClose() {
    if (isIncoming) decline();
    router.back();
  }

  const peerName = isIncoming ? call.peerName : params.peerName ?? call.peerName;
  const mode: CallMode = isIncoming ? call.mode : localMode;
  const modeTitle = mode === 'video' ? 'Video call' : 'Audio call';

  const statusLabel =
    call.phase === 'ended'
      ? call.endedOutcome === 'declined'
        ? 'Declined'
        : 'Not answered'
      : isIncoming
        ? `Incoming ${mode === 'video' ? 'video call' : 'call'}`
        : 'Ready to call';

  return (
    <View style={styles.flex}>
      <LinearGradient colors={['#331CA7', '#07060F']} style={styles.glow} pointerEvents="none" />

      <View style={styles.header}>
        <Pressable onPress={handleClose} style={styles.closeButton} accessibilityLabel="Close" accessibilityRole="button">
          <IconSymbol name="xmark" size={16} color="#fff" />
        </Pressable>
        <ThemedText type="defaultSemiBold" style={styles.modeTitle} lightColor="#fff" darkColor="#fff">
          {modeTitle}
        </ThemedText>
        <View style={styles.encryptedChip}>
          <IconSymbol name="lock.fill" size={11} color="#8FD9B4" />
          <ThemedText style={styles.encryptedLabel} lightColor="#8FD9B4" darkColor="#8FD9B4">
            Encrypted
          </ThemedText>
        </View>
      </View>

      <View style={styles.previewTile}>
        {mode === 'video' && call.camOn ? (
          <>
            <View style={styles.previewMonogramWrap}>
              <View style={styles.previewMonogramCircle}>
                <ThemedText style={styles.previewMonogram} lightColor="#fff" darkColor="#fff">
                  {(session?.displayName || '?').charAt(0).toUpperCase()}
                </ThemedText>
              </View>
            </View>
            <View style={styles.previewChipsTop}>
              <View style={styles.previewChip}>
                <ThemedText style={styles.previewChipLabel} lightColor="#fff" darkColor="#fff">
                  You
                </ThemedText>
              </View>
              {call.blurOn && (
                <View style={styles.previewChip}>
                  <ThemedText style={styles.previewChipLabel} lightColor="#fff" darkColor="#fff">
                    Blur
                  </ThemedText>
                </View>
              )}
            </View>
            <View style={styles.previewMetaLine}>
              <ThemedText style={styles.previewMetaText} lightColor="rgba(255,255,255,0.75)" darkColor="rgba(255,255,255,0.75)">
                Front camera · 720p
              </ThemedText>
            </View>
          </>
        ) : (
          <View style={styles.cameraOffPanel}>
            <IconSymbol name="video.slash.fill" size={28} color="rgba(255,255,255,0.6)" />
            <ThemedText style={styles.cameraOffText} lightColor="rgba(255,255,255,0.6)" darkColor="rgba(255,255,255,0.6)">
              Camera is off
            </ThemedText>
          </View>
        )}
      </View>

      <View style={styles.calleeRow}>
        <HubAvatar userId={call.peerId} displayName={peerName ?? '?'} tunnelUrl={session?.hub.tunnelUrl ?? ''} size={44} />
        <View style={styles.calleeText}>
          <ThemedText style={styles.calleeName} lightColor="#fff" darkColor="#fff">
            {peerName ?? 'Neighbor'}
          </ThemedText>
          <ThemedText style={styles.calleeMeta} lightColor="rgba(255,255,255,0.6)" darkColor="rgba(255,255,255,0.6)">
            {session?.hub.tunnelUrl.replace(/^https?:\/\//, '') ?? ''} · peer-to-peer
          </ThemedText>
          <ThemedText style={styles.calleeStatus} lightColor="rgba(255,255,255,0.85)" darkColor="rgba(255,255,255,0.85)">
            {statusLabel}
          </ThemedText>
        </View>
      </View>

      <View style={styles.togglesRow}>
        <ToggleButton icon={call.micOn ? 'mic.fill' : 'mic.slash.fill'} active={!call.micOn} label={call.micOn ? 'Mic on' : 'Muted'} onPress={toggleMic} />
        {mode === 'video' && (
          <>
            <ToggleButton icon={call.camOn ? 'video.fill' : 'video.slash.fill'} active={!call.camOn} label={call.camOn ? 'Camera on' : 'Camera off'} onPress={toggleCam} />
            <ToggleButton icon="rectangle.on.rectangle" active={call.blurOn} label={call.blurOn ? 'Blur on' : 'Blur'} onPress={toggleBlur} />
            {/* No live effect pre-connect — there's no local camera track
                to flip yet (the preview tile is a static monogram, not a
                real feed). Once actually connected, the in-call room's own
                Flip button (components/comms/in-call-overlay.tsx) is real. */}
            <ToggleButton icon="arrow.triangle.2.circlepath.camera.fill" active={false} label="Flip" onPress={() => {}} />
          </>
        )}
        {mode === 'audio' && (
          <ToggleButton icon={call.speakerOn ? 'speaker.wave.2.fill' : 'speaker.slash.fill'} active={call.speakerOn} label="Speaker" onPress={toggleSpeaker} />
        )}
      </View>

      {isIncoming ? (
        <>
          <Pressable onPress={answer} style={styles.primaryButton} accessibilityLabel="Answer">
            <ThemedText type="defaultSemiBold" style={styles.primaryLabel} lightColor="#fff" darkColor="#fff">
              Answer
            </ThemedText>
          </Pressable>
          <Pressable onPress={decline} style={styles.textButton}>
            <ThemedText style={styles.textButtonLabel} lightColor="rgba(255,255,255,0.75)" darkColor="rgba(255,255,255,0.75)">
              Decline
            </ThemedText>
          </Pressable>
        </>
      ) : (
        <>
          <Pressable onPress={handleStart} disabled={!outgoingParamsReady} style={[styles.primaryButton, !outgoingParamsReady && styles.primaryButtonDisabled]}>
            <ThemedText type="defaultSemiBold" style={styles.primaryLabel} lightColor="#fff" darkColor="#fff">
              {mode === 'video' ? 'Start video call' : 'Start audio call'}
            </ThemedText>
          </Pressable>
          <Pressable onPress={() => setLocalMode(mode === 'video' ? 'audio' : 'video')} style={styles.textButton}>
            <ThemedText style={styles.textButtonLabel} lightColor="rgba(255,255,255,0.75)" darkColor="rgba(255,255,255,0.75)">
              {mode === 'video' ? 'Switch to audio only' : 'Turn on video'}
            </ThemedText>
          </Pressable>
        </>
      )}
    </View>
  );
}

function ToggleButton({ icon, active, label, onPress }: { icon: Parameters<typeof IconSymbol>[0]['name']; active: boolean; label: string; onPress: () => void }) {
  return (
    <View style={styles.toggleItem}>
      <Pressable onPress={onPress} style={[styles.toggleCircle, active && styles.toggleCircleActive]}>
        <IconSymbol name={icon} size={22} color={active ? '#07060F' : '#fff'} />
      </Pressable>
      <ThemedText style={styles.toggleLabel} lightColor="rgba(255,255,255,0.8)" darkColor="rgba(255,255,255,0.8)" numberOfLines={1}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: '#07060F',
    paddingHorizontal: 20,
  },
  glow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 320,
    opacity: 0.5,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 56,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeTitle: {
    fontSize: 16,
  },
  encryptedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(143,217,180,0.14)',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  encryptedLabel: {
    fontSize: 10.5,
    fontWeight: '700',
  },
  previewTile: {
    flex: 1,
    marginTop: 20,
    borderRadius: 22,
    backgroundColor: '#331CA7',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewMonogramWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewMonogramCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewMonogram: {
    fontSize: 36,
    fontWeight: '600',
  },
  previewChipsTop: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    gap: 6,
  },
  previewChip: {
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  previewChipLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  previewMetaLine: {
    position: 'absolute',
    left: 12,
    bottom: 12,
  },
  previewMetaText: {
    fontSize: 11.5,
    fontVariant: ['tabular-nums'],
  },
  cameraOffPanel: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#100E1C',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  cameraOffText: {
    fontSize: 13,
  },
  calleeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 18,
  },
  calleeText: {
    flex: 1,
    gap: 2,
  },
  calleeName: {
    fontSize: 18,
  },
  calleeMeta: {
    fontSize: 11.5,
    fontVariant: ['tabular-nums'],
  },
  calleeStatus: {
    fontSize: 13,
    marginTop: 2,
  },
  togglesRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
    marginTop: 22,
  },
  toggleItem: {
    width: 66,
    alignItems: 'center',
    gap: 6,
  },
  toggleCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleCircleActive: {
    backgroundColor: '#fff',
  },
  toggleLabel: {
    fontSize: 11,
  },
  primaryButton: {
    height: 52,
    borderRadius: 26,
    backgroundColor: '#331CA7',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryLabel: {
    fontSize: 16,
  },
  textButton: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  textButtonLabel: {
    fontSize: 14,
  },
});
