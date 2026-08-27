import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Track } from 'livekit-client';
import { LiveKitRoom, RoomAudioRenderer, useLocalParticipant, useRemoteParticipants, useTracks, VideoTrack } from '@livekit/components-react';

import { HubAvatar } from '@/components/hub-avatar';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { getBroadcastGridBox } from '@/lib/comms/broadcast-grid';
import { useBroadcast } from '@/lib/comms/broadcast-context';
import { useBroadcastActions } from '@/lib/comms/use-broadcast-actions';
import { formatCallDuration, useElapsedSeconds } from '@/lib/comms/use-elapsed';
import { useSession } from '@/lib/session/session-context';

import { BroadcastDataBridge } from './broadcast-data-bridge';

// Web counterpart of broadcast-overlay.tsx — same split/reasoning as
// in-call-overlay.web.tsx (see that file's own note): @livekit/components-
// react's real <video>/<audio> elements instead of RTCView, everything else
// (hooks, layout, styles) identical since react-native-web renders View/
// Pressable/ThemedText as plain DOM either way.
export function BroadcastOverlay() {
  const { broadcast } = useBroadcast();
  const { session } = useSession();

  if (broadcast.phase !== 'live' || !broadcast.token || !broadcast.livekitUrl || !session) return null;

  const isHost = broadcast.role === 'host';
  // Diagnostic for the "joining immediately publishes as a presenter"
  // report — confirms whether a viewer's audio/video props are really
  // false at connect time.
  console.log('[broadcast] connecting', { role: broadcast.role, isHost, micOn: broadcast.micOn, camOn: broadcast.camOn, willPublishAudio: isHost && broadcast.micOn, willPublishVideo: isHost && broadcast.camOn });

  return (
    <View style={broadcast.minimized ? styles.hidden : styles.fill} pointerEvents={broadcast.minimized ? 'none' : 'auto'}>
      <LiveKitRoom serverUrl={broadcast.livekitUrl} token={broadcast.token} audio={isHost && broadcast.micOn} video={isHost && broadcast.camOn} connect style={{ position: 'absolute', inset: 0 }}>
        <RoomAudioRenderer />
        <BroadcastDataBridge />
        {!broadcast.minimized && <RoomContent />}
      </LiveKitRoom>
    </View>
  );
}

function RoomContent() {
  const { session } = useSession();
  const { broadcast, minimize, end, toggleMic, toggleCam } = useBroadcast();
  const { sendComment, sendHeart, requestToJoin, respondToRequest, endBroadcast } = useBroadcastActions();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();
  const tracks = useTracks([Track.Source.Camera, Track.Source.Microphone]);
  const [commentText, setCommentText] = useState('');
  const [liked, setLiked] = useState(false);
  const elapsed = useElapsedSeconds(broadcast.startedAt);

  const isHost = broadcast.role === 'host';
  const canPublish = isHost || broadcast.approvedToPublish;
  const viewerCount = remoteParticipants.length + 1;
  // Diagnostic for "host on the live screen doesn't see the accept card" —
  // if this logs a pendingRequest but the card still doesn't visually show,
  // it's a render/CSS issue; if this never logs anything, the request never
  // reached (or never got stored on) this client at all.
  console.log('[broadcast] render', { isHost, pendingRequest: broadcast.pendingRequest, minimized: broadcast.minimized });

  useEffect(() => {
    if (isHost || !broadcast.approvedToPublish) return;
    localParticipant.setMicrophoneEnabled(true).catch((err) => console.warn('[broadcast] mic publish failed', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadcast.approvedToPublish, isHost]);

  function handleToggleMic() {
    toggleMic();
    localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled).catch((err) => console.warn('[broadcast] toggle mic failed', err));
  }

  function handleToggleCam() {
    toggleCam();
    localParticipant.setCameraEnabled(!isCameraEnabled).catch((err) => console.warn('[broadcast] toggle camera failed', err));
  }

  function handleSend() {
    if (!commentText.trim()) return;
    sendComment(commentText);
    setCommentText('');
  }

  // Host ends the broadcast for everyone (broadcasts 'broadcast_ended' —
  // see use-broadcast-actions.ts); a guest/viewer leaving is purely local,
  // nothing to tell anyone else.
  function handleEnd() {
    if (isHost) endBroadcast();
    else end();
  }

  function handleToggleLike() {
    const next = !liked;
    setLiked(next);
    sendHeart(next ? 1 : -1);
  }

  const gridParticipants = new Map<string, { identity: string; name: string; isLocal: boolean; cameraTrack?: (typeof tracks)[number] }>();
  for (const t of tracks) {
    const identity = t.participant.identity;
    const entry = gridParticipants.get(identity) ?? { identity, name: t.participant.name || '?', isLocal: t.participant.isLocal, cameraTrack: undefined };
    if (t.source === Track.Source.Camera) entry.cameraTrack = t;
    gridParticipants.set(identity, entry);
  }
  const boxes = Array.from(gridParticipants.values());
  // Diagnostic for the "PC shows gradient, not real camera video" report —
  // confirms whether the subscription itself is the gap (cameraTrack never
  // set) versus a pure rendering issue (set but not visually showing).
  console.log('[broadcast] grid boxes', boxes.map((b) => ({ identity: b.identity, name: b.name, hasCameraTrack: !!b.cameraTrack })));
  const box = getBroadcastGridBox(boxes.length);
  const recentComments = broadcast.comments.slice(-4);

  return (
    <View style={styles.fill}>
      <View style={styles.canvas}>
        {boxes.map((p) => (
          <GridBox key={p.identity} widthPercent={box.widthPercent} heightPercent={box.heightPercent} avatarSize={box.avatarSize} userId={p.identity} name={p.name} tunnelUrl={session?.hub.tunnelUrl ?? ''} isHost={p.identity === broadcast.hostId}>
            {p.cameraTrack ? <VideoTrack trackRef={p.cameraTrack} style={webVideoStyle} /> : null}
          </GridBox>
        ))}
      </View>

      <LinearGradient colors={['rgba(0,0,0,0.62)', 'transparent']} style={styles.topBar} pointerEvents="box-none">
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <ThemedText style={styles.liveBadgeLabel} lightColor="#fff" darkColor="#fff">
            LIVE
          </ThemedText>
        </View>
        <View style={styles.viewerPill}>
          <IconSymbol name="eye.fill" size={12} color="#fff" />
          <ThemedText style={styles.viewerPillText} lightColor="#fff" darkColor="#fff">
            {viewerCount}
          </ThemedText>
        </View>
        <View style={styles.viewerPill}>
          <IconSymbol name="heart.fill" size={12} color="#fff" />
          <ThemedText style={styles.viewerPillText} lightColor="#fff" darkColor="#fff">
            {broadcast.hearts}
          </ThemedText>
        </View>
        <ThemedText style={styles.elapsedText} lightColor="rgba(255,255,255,0.75)" darkColor="rgba(255,255,255,0.75)">
          {formatCallDuration(elapsed)}
        </ThemedText>
        <Pressable onPress={minimize} style={styles.minimizePill}>
          <ThemedText style={styles.minimizePillLabel} lightColor="#fff" darkColor="#fff">
            Minimize
          </ThemedText>
        </Pressable>
      </LinearGradient>

      <View style={styles.underTopBar} pointerEvents="box-none">
        {isHost && broadcast.pendingRequest && (
          <View style={styles.requestCard}>
            <HubAvatar userId={broadcast.pendingRequest.requesterId} displayName={broadcast.pendingRequest.requesterName} tunnelUrl={session?.hub.tunnelUrl ?? ''} size={32} />
            <ThemedText style={styles.requestText} lightColor="#fff" darkColor="#fff" numberOfLines={1}>
              {broadcast.pendingRequest.requesterName} wants to join in
            </ThemedText>
            <Pressable onPress={() => broadcast.pendingRequest && respondToRequest(broadcast.pendingRequest, false)} style={styles.requestDeclineButton}>
              <ThemedText style={styles.requestDeclineLabel} lightColor="rgba(255,255,255,0.75)" darkColor="rgba(255,255,255,0.75)">
                Not now
              </ThemedText>
            </Pressable>
            <Pressable onPress={() => broadcast.pendingRequest && respondToRequest(broadcast.pendingRequest, true)} style={styles.requestAddButton}>
              <ThemedText style={styles.requestAddLabel} lightColor="#07060F" darkColor="#07060F">
                Add
              </ThemedText>
            </Pressable>
          </View>
        )}
        <View style={styles.titleChip}>
          <ThemedText style={styles.titleChipText} lightColor="#fff" darkColor="#fff" numberOfLines={1}>
            {broadcast.title}
          </ThemedText>
        </View>
      </View>

      <View style={styles.bottomScrim} pointerEvents="box-none">
        {recentComments.length > 0 && (
          <View style={styles.commentsList}>
            {recentComments.map((c) =>
              c.system ? (
                <ThemedText key={c.id} style={styles.systemComment} lightColor="rgba(255,255,255,0.6)" darkColor="rgba(255,255,255,0.6)">
                  {c.text}
                </ThemedText>
              ) : (
                <View key={c.id} style={styles.commentRow}>
                  <HubAvatar userId={c.senderId} displayName={c.senderName} tunnelUrl={session?.hub.tunnelUrl ?? ''} size={24} />
                  <ThemedText style={styles.commentText} lightColor="#fff" darkColor="#fff" numberOfLines={2}>
                    <ThemedText type="defaultSemiBold" lightColor="#fff" darkColor="#fff">
                      {c.senderName}{' '}
                    </ThemedText>
                    {c.text}
                  </ThemedText>
                </View>
              )
            )}
          </View>
        )}

        <View style={styles.composerRow}>
          <View style={styles.composerPill}>
            <TextInput value={commentText} onChangeText={setCommentText} placeholder="Say something…" placeholderTextColor="rgba(255,255,255,0.5)" style={styles.composerInput} onSubmitEditing={handleSend} returnKeyType="send" />
            {commentText.trim().length > 0 && (
              <Pressable onPress={handleSend} hitSlop={8}>
                <IconSymbol name="paperplane.fill" size={18} color="#fff" />
              </Pressable>
            )}
          </View>
          <Pressable onPress={handleToggleLike} style={styles.heartButton}>
            <IconSymbol name="heart.fill" size={20} color={liked ? '#DC2B2B' : '#fff'} />
          </Pressable>
        </View>

        <View style={styles.controlsRow}>
          {canPublish && (
            <>
              <ControlCircle icon={isMicrophoneEnabled ? 'mic.fill' : 'mic.slash.fill'} active={!isMicrophoneEnabled} onPress={handleToggleMic} />
              <ControlCircle icon={isCameraEnabled ? 'video.fill' : 'video.slash.fill'} active={!isCameraEnabled} onPress={handleToggleCam} />
            </>
          )}
          {isHost ? (
            <Pressable onPress={handleEnd} style={styles.endButton}>
              <ThemedText type="defaultSemiBold" style={styles.endButtonLabel} lightColor="#fff" darkColor="#fff">
                End
              </ThemedText>
            </Pressable>
          ) : canPublish ? (
            <Pressable onPress={handleEnd} style={styles.leaveButton}>
              <ThemedText type="defaultSemiBold" style={styles.leaveButtonLabel} lightColor="#07060F" darkColor="#07060F">
                Leave
              </ThemedText>
            </Pressable>
          ) : (
            <>
              {/* A plain viewer who never asked to join in (or is still
                  waiting on a response) had no way out of this screen at
                  all before except minimizing — Leave here just ends their
                  own viewing session, same handleEnd path as a promoted
                  guest's Leave above. */}
              <Pressable onPress={handleEnd} style={styles.viewerLeaveButton}>
                <ThemedText style={styles.viewerLeaveLabel} lightColor="rgba(255,255,255,0.8)" darkColor="rgba(255,255,255,0.8)">
                  Leave
                </ThemedText>
              </Pressable>
              <Pressable onPress={requestToJoin} disabled={broadcast.joinRequestPending} style={[styles.joinInButton, broadcast.joinRequestPending && styles.joinInButtonPending]}>
                <ThemedText type="defaultSemiBold" style={styles.joinInLabel} lightColor="#07060F" darkColor="#07060F">
                  {broadcast.joinRequestPending ? 'Requested' : 'Join in'}
                </ThemedText>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

// Plain CSSProperties, not RN style objects — VideoTrack here is
// @livekit/components-react's real <video>, not RTCView (see in-call-
// overlay.web.tsx's own webVideoStyle for the same reasoning).
const webVideoStyle = { width: '100%', height: '100%', objectFit: 'cover' } as const;

function GridBox({
  widthPercent,
  heightPercent,
  avatarSize,
  userId,
  name,
  tunnelUrl,
  isHost,
  children,
}: {
  widthPercent: number;
  heightPercent: number;
  avatarSize: number;
  userId: string;
  name: string;
  tunnelUrl: string;
  isHost: boolean;
  children?: React.ReactNode;
}) {
  return (
    <View style={[styles.gridBox, { width: `${widthPercent}%`, height: `${heightPercent}%` }]}>
      <LinearGradient colors={['#331CA7', '#100E1C']} style={StyleSheet.absoluteFillObject} />
      {/* On web, a position:absolute sibling paints above position:static
          content regardless of DOM order — the gradient above was covering
          the video every time despite coming first in JSX. Giving this
          wrapper the same absolute positioning makes normal DOM-order
          stacking apply, so it correctly paints on top instead. */}
      <View style={[StyleSheet.absoluteFillObject, styles.gridBoxContent]}>
        {children ?? (
          <View style={styles.gridBoxAvatarWrap}>
            <HubAvatar userId={userId} displayName={name} tunnelUrl={tunnelUrl} size={avatarSize} />
          </View>
        )}
      </View>
      <View style={styles.gridBoxChip}>
        <ThemedText style={styles.gridBoxChipName} lightColor="#fff" darkColor="#fff" numberOfLines={1}>
          {name}
        </ThemedText>
        <ThemedText style={styles.gridBoxChipRole} lightColor="rgba(255,255,255,0.7)" darkColor="rgba(255,255,255,0.7)">
          {isHost ? 'HOST' : 'GUEST'}
        </ThemedText>
      </View>
    </View>
  );
}

function ControlCircle({ icon, active, onPress }: { icon: Parameters<typeof IconSymbol>[0]['name']; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.controlCircle, active && styles.controlCircleActive]}>
      <IconSymbol name={icon} size={20} color={active ? '#07060F' : '#fff'} />
    </Pressable>
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
  canvas: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    padding: 6,
    paddingBottom: 244,
    backgroundColor: '#000',
  },
  gridBox: {
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridBoxContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridBoxAvatarWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridBoxChip: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  gridBoxChipName: {
    fontSize: 12,
    fontWeight: '600',
  },
  gridBoxChipRole: {
    fontSize: 8.5,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 24,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#DC2B2B',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#fff',
  },
  liveBadgeLabel: {
    fontSize: 11,
    fontWeight: '800',
  },
  viewerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  viewerPillText: {
    fontSize: 11.5,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
  elapsedText: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    flex: 1,
  },
  minimizePill: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  minimizePillLabel: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  underTopBar: {
    position: 'absolute',
    top: 60,
    left: 16,
    right: 16,
    gap: 8,
  },
  requestCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(51,28,167,0.55)',
    borderRadius: 16,
    padding: 10,
  },
  requestText: {
    flex: 1,
    fontSize: 12.5,
  },
  requestDeclineButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  requestDeclineLabel: {
    fontSize: 12,
  },
  requestAddButton: {
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  requestAddLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  titleChip: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    maxWidth: '100%',
  },
  titleChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  bottomScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.78)',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 20,
    gap: 12,
  },
  commentsList: {
    maxHeight: 150,
    gap: 6,
  },
  commentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  commentText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 17,
  },
  systemComment: {
    fontSize: 11.5,
    fontStyle: 'italic',
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  composerPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  composerInput: {
    flex: 1,
    fontSize: 14,
    color: '#fff',
    padding: 0,
  },
  heartButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  controlCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlCircleActive: {
    backgroundColor: '#fff',
  },
  endButton: {
    height: 48,
    borderRadius: 24,
    backgroundColor: '#DC2B2B',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  endButtonLabel: {
    fontSize: 15,
  },
  leaveButton: {
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  leaveButtonLabel: {
    fontSize: 15,
  },
  joinInButton: {
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  joinInButtonPending: {
    opacity: 0.55,
  },
  joinInLabel: {
    fontSize: 15,
  },
  viewerLeaveButton: {
    height: 48,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  viewerLeaveLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
});
