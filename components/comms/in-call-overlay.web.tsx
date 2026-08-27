import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Track } from 'livekit-client';
import { LiveKitRoom, RoomAudioRenderer, useLocalParticipant, useRemoteParticipants, useTracks, VideoTrack } from '@livekit/components-react';

import { HubAvatar } from '@/components/hub-avatar';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { useCall } from '@/lib/comms/call-context';
import { formatCallDuration, useElapsedSeconds } from '@/lib/comms/use-elapsed';
import { useSession } from '@/lib/session/session-context';

// Web counterpart of in-call-overlay.tsx (Metro resolves this automatically
// for the web bundle, the bare .tsx for ios/android — same platform-split
// convention as icon-symbol.ios.tsx/.tsx). @livekit/react-native can't be
// imported here at all: it pulls in @livekit/react-native-webrtc, a
// native-only package with no web build, so this file goes straight to
// @livekit/components-react instead — the actual web-native LiveKit
// components (a real <video> element under VideoTrack, not RTCView).
// Everything else — hooks (useLocalParticipant, useTracks, etc.), the
// surrounding View/Pressable/ThemedText layout, all of `styles` below — is
// identical to the native file; react-native-web already renders those as
// plain DOM under the hood, same as every other screen in this app that
// runs on web.
//
// For quick desktop-browser testing only, per the product ask — not a
// polished parity build (no PiP window, no background blur, camera "flip"
// is a same-device no-op since laptops don't have a front/back camera to
// flip between).
export function InCallOverlay() {
  const { call } = useCall();
  const { session } = useSession();

  if ((call.phase !== 'connected' && call.phase !== 'outgoing') || !call.token || !call.livekitUrl || !session) return null;

  return (
    <View style={call.minimized ? styles.hidden : styles.fill} pointerEvents={call.minimized ? 'none' : 'auto'}>
      <LiveKitRoom
        serverUrl={call.livekitUrl}
        token={call.token}
        audio={call.micOn}
        video={call.mode === 'video' && call.camOn}
        connect
        style={{ position: 'absolute', inset: 0 }}>
        {/* @livekit/components-react doesn't auto-play remote audio the way
            VideoTrack self-renders video — without this, subscribed audio
            tracks reach the peer connection but never hit a playable
            <audio> element, so the browser stays silent. */}
        <RoomAudioRenderer />
        {!call.minimized && <RoomContent />}
      </LiveKitRoom>
    </View>
  );
}

function RoomContent() {
  const { session } = useSession();
  const { call, minimize, end, toggleLayout, toggleMic, toggleCam, toggleSpeaker, toggleSharing, setMode } = useCall();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();
  const remote = remoteParticipants[0];
  const cameraTracks = useTracks([Track.Source.Camera]);
  const localTrackRef = cameraTracks.find((t) => t.participant.isLocal);
  const remoteTrackRef = cameraTracks.find((t) => !t.participant.isLocal);
  const elapsed = useElapsedSeconds(call.startedAt);

  function handleEnd() {
    end();
  }

  function handleToggleMic() {
    toggleMic();
    localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled).catch(() => {});
  }

  function handleToggleCam() {
    toggleCam();
    localParticipant.setCameraEnabled(!isCameraEnabled).catch(() => {});
  }

  function handleToggleShare() {
    toggleSharing();
    // Triggers the browser's own getDisplayMedia() picker — no extra wiring
    // needed on web, unlike native where screen share needs a separate
    // platform capability.
    localParticipant.setScreenShareEnabled(!isScreenShareEnabled).catch(() => {});
  }

  const statusLine = call.phase === 'outgoing' ? 'Ringing…' : formatCallDuration(elapsed);

  return (
    <View style={styles.fill}>
      {call.mode === 'video' ? (
        <View style={[styles.videoArea, call.layout === 'focus' && styles.videoAreaFocus]}>
          {call.layout === 'split' ? (
            <>
              <View style={[styles.tile, styles.remoteTileSplit]}>
                {remoteTrackRef ? (
                  <VideoTrack trackRef={remoteTrackRef} style={webVideoStyle} />
                ) : (
                  <RemoteFallback name={call.peerName} />
                )}
              </View>
              <View style={[styles.tile, styles.selfTileSplit]}>
                {localTrackRef && isCameraEnabled ? (
                  <VideoTrack trackRef={localTrackRef} style={mirroredVideoStyle} />
                ) : (
                  <SelfFallback />
                )}
              </View>
            </>
          ) : (
            <>
              <View style={[styles.tile, styles.remoteTileFocus]}>
                {remoteTrackRef ? (
                  <VideoTrack trackRef={remoteTrackRef} style={webVideoStyle} />
                ) : (
                  <RemoteFallback name={call.peerName} />
                )}
              </View>
              <View style={[styles.tile, styles.selfTilePip]}>
                {localTrackRef && isCameraEnabled ? (
                  <VideoTrack trackRef={localTrackRef} style={mirroredVideoStyle} />
                ) : (
                  <SelfFallback compact />
                )}
              </View>
            </>
          )}
        </View>
      ) : (
        <View style={styles.audioArea}>
          <HubAvatar userId={call.peerId} displayName={call.peerName ?? '?'} tunnelUrl={session?.hub.tunnelUrl ?? ''} size={140} />
        </View>
      )}

      {call.sharingOn && (
        <View style={styles.shareBanner}>
          <ThemedText style={styles.shareBannerText} lightColor="#fff" darkColor="#fff">
            Sharing your screen
          </ThemedText>
          <Pressable onPress={handleToggleShare} style={styles.shareStopButton}>
            <ThemedText style={styles.shareStopLabel} lightColor="#fff" darkColor="#fff">
              Stop
            </ThemedText>
          </Pressable>
        </View>
      )}

      <LinearGradient colors={['rgba(0,0,0,0.62)', 'transparent']} style={styles.topBar} pointerEvents="box-none">
        <Pressable onPress={minimize} hitSlop={12} accessibilityLabel="Minimize">
          <IconSymbol name="chevron.down" size={22} color="#fff" />
        </Pressable>
        <View style={styles.topBarCenter}>
          <ThemedText type="defaultSemiBold" style={styles.peerName} lightColor="#fff" darkColor="#fff">
            {call.peerName ?? remote?.name ?? 'Neighbor'}
          </ThemedText>
          <ThemedText style={styles.statusLine} lightColor="rgba(255,255,255,0.7)" darkColor="rgba(255,255,255,0.7)">
            {statusLine}
          </ThemedText>
        </View>
        <View style={styles.topBarRight}>
          <View style={styles.connectionPill}>
            <IconSymbol name="wifi" size={12} color="#4ADE80" />
            <ThemedText style={styles.connectionPillText} lightColor="#4ADE80" darkColor="#4ADE80">
              Direct · P2P
            </ThemedText>
          </View>
          {call.mode === 'video' && (
            <Pressable onPress={toggleLayout} hitSlop={10} accessibilityLabel="Toggle layout">
              <IconSymbol name={call.layout === 'split' ? 'arrow.up.left.and.arrow.down.right' : 'square.grid.2x2'} size={18} color="#fff" />
            </Pressable>
          )}
        </View>
      </LinearGradient>

      <View style={styles.controlsWrap}>
        <View style={styles.controlsPill}>
          <ControlButton icon={isMicrophoneEnabled ? 'mic.fill' : 'mic.slash.fill'} active={!isMicrophoneEnabled} label={isMicrophoneEnabled ? 'Mic on' : 'Muted'} onPress={handleToggleMic} />
          {call.mode === 'video' ? (
            <ControlButton icon={isCameraEnabled ? 'video.fill' : 'video.slash.fill'} active={!isCameraEnabled} label={isCameraEnabled ? 'Camera on' : 'Camera off'} onPress={handleToggleCam} />
          ) : (
            <ControlButton icon="video.fill" active={false} label="Video" onPress={() => setMode('video')} />
          )}
          <ControlButton icon={call.speakerOn ? 'speaker.wave.2.fill' : 'speaker.slash.fill'} active={call.speakerOn} label={call.speakerOn ? 'Speaker' : 'Earpiece'} onPress={toggleSpeaker} />
          <ControlButton icon="rectangle.on.rectangle" active={call.sharingOn} label={call.sharingOn ? 'Sharing' : 'Share'} onPress={handleToggleShare} />
        </View>
        <Pressable onPress={handleEnd} style={styles.endButton} accessibilityLabel="End call">
          <IconSymbol name="phone.down.fill" size={26} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

// Plain CSSProperties, not RN style objects — VideoTrack here is
// @livekit/components-react's real <video>, not an RN component.
const webVideoStyle = { width: '100%', height: '100%', objectFit: 'cover' } as const;
const mirroredVideoStyle = { ...webVideoStyle, transform: 'scaleX(-1)' } as const;

function ControlButton({
  icon,
  active,
  label,
  onPress,
}: {
  icon: Parameters<typeof IconSymbol>[0]['name'];
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.controlItem}>
      <Pressable onPress={onPress} style={[styles.controlCircle, active && styles.controlCircleActive]}>
        <IconSymbol name={icon} size={22} color={active ? '#07060F' : '#fff'} />
      </Pressable>
      <ThemedText style={styles.controlLabel} lightColor="rgba(255,255,255,0.8)" darkColor="rgba(255,255,255,0.8)" numberOfLines={1}>
        {label}
      </ThemedText>
    </View>
  );
}

function RemoteFallback({ name }: { name: string | null }) {
  return (
    <View style={[styles.fill, styles.fallbackTile]}>
      <View style={styles.fallbackCircle}>
        <ThemedText style={styles.fallbackInitial} lightColor="#fff" darkColor="#fff">
          {(name || '?').charAt(0).toUpperCase()}
        </ThemedText>
      </View>
    </View>
  );
}

function SelfFallback({ compact }: { compact?: boolean }) {
  return (
    <View style={[styles.fill, styles.fallbackTile, styles.selfFallbackTile]}>
      <View style={[styles.fallbackCircle, compact && styles.fallbackCircleCompact]}>
        <IconSymbol name="video.slash.fill" size={compact ? 16 : 24} color="rgba(255,255,255,0.7)" />
      </View>
      {!compact && (
        <ThemedText style={styles.cameraOffLabel} lightColor="rgba(255,255,255,0.7)" darkColor="rgba(255,255,255,0.7)">
          Camera is off
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
  hidden: {
    width: 0,
    height: 0,
    overflow: 'hidden',
  },
  videoArea: {
    flex: 1,
    flexDirection: 'column',
    padding: 12,
    paddingBottom: 190,
    gap: 6,
    backgroundColor: '#07060F',
  },
  videoAreaFocus: {
    padding: 0,
    paddingBottom: 0,
  },
  tile: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#100E1C',
  },
  remoteTileSplit: {
    flex: 1.3,
  },
  selfTileSplit: {
    flex: 1,
  },
  remoteTileFocus: {
    flex: 1,
    borderRadius: 0,
  },
  selfTilePip: {
    position: 'absolute',
    right: 12,
    bottom: 196,
    width: 116,
    height: 164,
    borderRadius: 16,
  },
  audioArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#07060F',
  },
  fallbackTile: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#331CA7',
  },
  selfFallbackTile: {
    backgroundColor: '#100E1C',
    gap: 8,
  },
  fallbackCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackCircleCompact: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  fallbackInitial: {
    fontSize: 36,
    fontWeight: '600',
  },
  cameraOffLabel: {
    fontSize: 13,
  },
  shareBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#331CA7',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 10,
  },
  shareBannerText: {
    fontSize: 13,
    fontWeight: '600',
  },
  shareStopButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  shareStopLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 24,
  },
  topBarCenter: {
    alignItems: 'center',
  },
  peerName: {
    fontSize: 15,
  },
  statusLine: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  connectionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  connectionPillText: {
    fontSize: 10.5,
    fontWeight: '700',
  },
  controlsWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 24,
    alignItems: 'center',
    gap: 16,
  },
  controlsPill: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 4,
  },
  controlItem: {
    width: 66,
    alignItems: 'center',
    gap: 6,
  },
  controlCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlCircleActive: {
    backgroundColor: '#fff',
  },
  controlLabel: {
    fontSize: 11,
  },
  endButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#DC2B2B',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
