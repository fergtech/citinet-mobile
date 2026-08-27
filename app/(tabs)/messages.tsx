import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useScrollToTop } from '@react-navigation/native';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { BrandGradient } from '@/components/brand-gradient';
import { HubAvatar } from '@/components/hub-avatar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Brand } from '@/constants/theme';
import { listConversations, listLiveComms } from '@/lib/api/hubService';
import { HubConversation, LiveCommsItem } from '@/lib/api/types';
import { useBroadcast } from '@/lib/comms/broadcast-context';
import { formatCallDuration, useElapsedSeconds } from '@/lib/comms/use-elapsed';
import { useE2EKeys } from '@/lib/crypto/e2e-context';
import { useSession } from '@/lib/session/session-context';
import { isEncryptedBody } from '@/lib/ui/encrypted-message';
import { timeAgo } from '@/lib/ui/time-ago';

function getPeer(convo: HubConversation, selfId: string) {
  return convo.members.find((m) => m.user_id !== selfId) ?? null;
}

function getTitle(convo: HubConversation, selfId: string): string {
  if (convo.kind === 'group') {
    if (convo.name) return convo.name;
    const others = convo.members.filter((m) => m.user_id !== selfId).map((m) => m.username);
    return others.join(', ') || 'Group';
  }
  return getPeer(convo, selfId)?.username ?? 'Unknown';
}

// `decrypted` is populated asynchronously (see the effect below) — undefined
// means "hasn't resolved yet" (or isn't encrypted), so the sentinel-shaped
// placeholder is the right thing to show until then.
function getPreview(convo: HubConversation, decrypted: string | undefined): string {
  const msg = convo.last_message;
  if (!msg) return 'No messages yet';
  if (isEncryptedBody(msg.body)) {
    return decrypted !== undefined ? decrypted || 'No messages yet' : '🔒 Encrypted message';
  }
  if (!msg.body.trim() && msg.attachments?.length) return '📎 Attachment';
  return msg.body.trim() || 'No messages yet';
}

function isUnread(convo: HubConversation, selfId: string): boolean {
  const msg = convo.last_message;
  if (!msg || msg.sender_id === selfId) return false;
  const self = convo.members.find((m) => m.user_id === selfId);
  if (!self?.last_read_at) return true;
  return new Date(msg.created_at) > new Date(self.last_read_at);
}

// No preview thumbnail exists for a room's stream (would mean subscribing
// to every live card's video just to render a list, expensive for what's
// meant to be a lightweight strip) — a brand/red gradient placeholder fills
// the same visual role honestly, same simplification this app already uses
// for avatars with no uploaded photo. Only broadcast cards are tappable —
// joins as a viewer (see BroadcastProvider's joinAsViewer). Rooms (kind
// 'room', the OPEN badge) don't have a destination screen yet.
function LiveCard({ item, onPress }: { item: LiveCommsItem; onPress?: () => void }) {
  const isLive = item.kind === 'broadcast';
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={styles.liveCard}>
      <BrandGradient style={StyleSheet.absoluteFillObject} />
      <View style={[styles.liveBadge, { backgroundColor: isLive ? '#DC2B2B' : Brand }]}>
        <ThemedText style={styles.liveBadgeLabel} lightColor="#fff" darkColor="#fff">
          {isLive ? 'LIVE' : 'OPEN'}
        </ThemedText>
      </View>
      <View style={styles.liveCountPill}>
        <ThemedText style={styles.liveCountText} lightColor="#fff" darkColor="#fff">
          {item.participant_count} {isLive ? 'watching' : 'here'}
        </ThemedText>
      </View>
      <View style={styles.liveCardFooter}>
        <View style={styles.liveHostRow}>
          <View style={styles.liveHostMonogram}>
            <ThemedText style={styles.liveHostInitial} lightColor="#fff" darkColor="#fff">
              {(item.host_username || '?').charAt(0).toUpperCase()}
            </ThemedText>
          </View>
          <ThemedText style={styles.liveHostName} lightColor="#fff" darkColor="#fff" numberOfLines={1}>
            {item.host_username} · {isLive ? 'Broadcast' : 'Room'}
          </ThemedText>
        </View>
        <ThemedText style={styles.liveTitle} lightColor="#fff" darkColor="#fff" numberOfLines={2}>
          {item.title || (isLive ? 'Live broadcast' : 'Open room')}
        </ThemedText>
      </View>
    </Pressable>
  );
}

// Own component, same reasoning as MinimizedCallBar in app/conversation/
// [id].tsx: the elapsed-seconds tick only re-renders this small bar, not
// the whole Messages screen.
function MinimizedBroadcastBar({ onPress }: { onPress: () => void }) {
  const { broadcast } = useBroadcast();
  const elapsed = useElapsedSeconds(broadcast.startedAt);
  // The join-request card only exists inside the live screen itself
  // (components/comms/broadcast-overlay.tsx) — a minimized host would
  // otherwise never know one arrived at all. This is the only surface that
  // exists while minimized, so it has to carry that signal.
  const hasPendingRequest = broadcast.role === 'host' && !!broadcast.pendingRequest;
  return (
    <Pressable onPress={onPress} style={[styles.minimizeBar, hasPendingRequest && styles.minimizeBarAlert]}>
      <View style={[styles.minimizeDot, hasPendingRequest && styles.minimizeDotAlert]} />
      <ThemedText style={styles.minimizeLabel} lightColor="#fff" darkColor="#fff" numberOfLines={1}>
        {hasPendingRequest ? `${broadcast.pendingRequest!.requesterName} wants to join in` : broadcast.role === 'host' ? 'Broadcasting live' : 'Watching live'}
      </ThemedText>
      <ThemedText style={styles.minimizeTimer} lightColor="#fff" darkColor="#fff">
        {formatCallDuration(elapsed)}
      </ThemedText>
      <IconSymbol name="chevron.up" size={14} color="#fff" />
    </Pressable>
  );
}

export default function MessagesScreen() {
  const { session } = useSession();
  const { ensure, attention, decryptForConversation } = useE2EKeys();
  const { broadcast, joinAsViewer, restore } = useBroadcast();
  // Only iOS's tab bar floats over content (see app/(tabs)/_layout.tsx) —
  // compensate so the last row doesn't end up hidden behind the glass.
  const tabBarHeight = useBottomTabBarHeight();
  const extraBottomInset = Platform.OS === 'ios' ? tabBarHeight : 0;
  const [conversations, setConversations] = useState<HubConversation[]>([]);
  const [previews, setPreviews] = useState<Map<string, string>>(new Map());
  const [live, setLive] = useState<LiveCommsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Computed once, used for both the "Live now" header's visibility and the
  // strip itself — the header used to check raw `live.length` while the
  // strip filtered separately, so ending your only broadcast could leave
  // the "Live now" eyebrow showing over an empty strip.
  const visibleLive = useMemo(
    () => live.filter((item) => item.host_id !== session?.userId || (broadcast.phase === 'live' && broadcast.roomName === item.room_name)),
    [live, session, broadcast.phase, broadcast.roomName]
  );

  // Re-tapping the Chat tab while already on it scrolls back to the top —
  // same as Home (see (tabs)/index.tsx's own useScrollToTop).
  const listRef = useRef<FlatList<HubConversation>>(null);
  useScrollToTop(listRef);

  const load = useCallback(() => {
    if (!session) return;
    setLoading(true);
    setError(null);
    listConversations(session.hub.tunnelUrl, session.token)
      .then(setConversations)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load.'))
      .finally(() => setLoading(false));
  }, [session]);

  // Focus-based, not mount-only: opening a conversation marks it read
  // server-side (a side effect of GET /api/conversations/:id/messages), but
  // this screen's own `conversations` state — including the unread dot —
  // only reflects that once it's refetched. A plain mount-only effect left
  // the dot showing until a manual pull-to-refresh or a fresh app load; this
  // refetches every time Messages regains focus, e.g. backing out of a
  // conversation, so the dot clears on its own like it should.
  useFocusEffect(load);

  // Real fetch (GET /api/comms/live, LiveKit's own room list — see
  // hubService.ts's own note) — empty until a broadcast/room actually
  // exists. Rooms (kind 'room') still have no mobile create screen; the
  // Broadcast pill below does (app/broadcast/setup.tsx).
  const refreshLive = useCallback(() => {
    if (!session) return;
    listLiveComms(session.hub.tunnelUrl, session.token).then(setLive);
  }, [session]);

  useFocusEffect(refreshLive);

  // Focus alone only catches a broadcast *this device* started/ended — it
  // does nothing for one that started on someone else's device, since
  // there's no push channel for that (unlike calls — see lib/comms/
  // socket.ts's own note on why that one's special). Polling every 15s
  // while this screen is actually visible is the low-effort middle ground:
  // not instant, but another device's new broadcast shows up on its own
  // instead of requiring a manual navigate-away-and-back.
  useFocusEffect(
    useCallback(() => {
      const id = setInterval(refreshLive, 15000);
      return () => clearInterval(id);
    }, [refreshLive])
  );

  // Focus alone left this screen showing a stale watching-count (or a
  // just-started broadcast missing entirely) whenever you started/ended one
  // without ever navigating away — minimizing stays on this same screen
  // instance, so no focus event fires. Reacting to the phase transition
  // directly instead catches both cases.
  useEffect(() => {
    if (broadcast.phase === 'live' || broadcast.phase === 'idle') refreshLive();
  }, [broadcast.phase, refreshLive]);

  useEffect(() => {
    ensure();
  }, [ensure]);

  useEffect(() => {
    if (attention) router.push((attention === 'unlock' ? '/e2e-unlock' : '/e2e-setup') as Href);
  }, [attention]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      const next = new Map<string, string>();
      for (const convo of conversations) {
        const msg = convo.last_message;
        if (!msg || !isEncryptedBody(msg.body)) continue;
        const peer = convo.kind === 'dm' ? getPeer(convo, session.userId) : null;
        const plain = await decryptForConversation(convo.conversation_id, peer?.user_id ?? null, msg.body);
        if (plain !== null) next.set(convo.conversation_id, plain);
      }
      if (!cancelled) setPreviews(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [conversations, decryptForConversation, session]);

  if (!session) return null;

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title" style={styles.headerTitle}>
          Communications
        </ThemedText>
      </View>

      {loading && conversations.length === 0 && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      {broadcast.phase === 'live' && broadcast.minimized && <MinimizedBroadcastBar onPress={restore} />}

      <FlatList
        ref={listRef}
        data={conversations}
        keyExtractor={(item) => item.conversation_id}
        contentContainerStyle={[styles.list, { paddingBottom: 24 + extraBottomInset }]}
        onRefresh={() => {
          load();
          refreshLive();
        }}
        refreshing={loading}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.entryRow}>
              <Pressable onPress={() => router.push('/broadcast/setup')} style={styles.broadcastPill}>
                <IconSymbol name="dot.radiowaves.left.and.right" size={14} color="#DC2B2B" />
                <ThemedText style={[styles.broadcastPillLabel, { color: '#DC2B2B' }]}>Broadcast</ThemedText>
              </Pressable>
            </ScrollView>

            {visibleLive.length > 0 && (
              <>
                <View style={styles.liveEyebrowRow}>
                  <View style={styles.liveDot} />
                  <ThemedText style={styles.eyebrow}>Live now</ThemedText>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.liveStrip}>
                  {visibleLive.map((item) => {
                    // A card for the broadcast I'm already in (as host or
                    // as a joined viewer/guest, just minimized) must
                    // restore that session, not start a fresh join —
                    // joining my own room as a brand-new viewer identity
                    // is how "my own live" ended up showing "Join in"
                    // instead of host controls.
                    const isMine = broadcast.phase === 'live' && broadcast.roomName === item.room_name;
                    return (
                      <LiveCard
                        key={item.room_name}
                        item={item}
                        onPress={item.kind === 'broadcast' ? (isMine ? restore : () => joinAsViewer(item)) : undefined}
                      />
                    );
                  })}
                </ScrollView>
              </>
            )}

            <ThemedText style={styles.eyebrow}>Direct messages</ThemedText>
          </View>
        }
        renderItem={({ item }) => {
          const peer = item.kind === 'dm' ? getPeer(item, session.userId) : null;
          const unread = isUnread(item, session.userId);
          return (
            <Pressable
              style={styles.row}
              onPress={() =>
                router.push({
                  pathname: '/conversation/[id]',
                  params: {
                    id: item.conversation_id,
                    title: getTitle(item, session.userId),
                    peerId: peer?.user_id ?? '',
                  },
                })
              }>
              {peer ? (
                <HubAvatar userId={peer.user_id} displayName={peer.username} tunnelUrl={session.hub.tunnelUrl} size={44} />
              ) : (
                <BrandGradient style={styles.groupAvatar}>
                  <IconSymbol name="message.fill" size={18} color="#fff" />
                </BrandGradient>
              )}
              <View style={styles.rowText}>
                <View style={styles.rowTop}>
                  <ThemedText type="defaultSemiBold" numberOfLines={1} style={styles.name}>
                    {getTitle(item, session.userId)}
                  </ThemedText>
                  {item.last_message && (
                    <ThemedText style={styles.time}>{timeAgo(item.last_message.created_at)}</ThemedText>
                  )}
                </View>
                <ThemedText numberOfLines={1} style={[styles.preview, unread && styles.previewUnread]}>
                  {getPreview(item, previews.get(item.conversation_id))}
                </ThemedText>
              </View>
              {unread && <BrandGradient style={styles.unreadDot} />}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          !loading ? <ThemedText style={styles.empty}>No conversations yet.</ThemedText> : null
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 22,
  },
  spinner: {
    marginTop: 24,
  },
  error: {
    color: '#b0392f',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  list: {
    paddingHorizontal: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  groupAvatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  name: {
    flex: 1,
  },
  time: {
    fontSize: 12,
    opacity: 0.5,
  },
  preview: {
    fontSize: 14,
    opacity: 0.6,
  },
  previewUnread: {
    opacity: 1,
    fontWeight: '600',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  empty: {
    opacity: 0.6,
    fontSize: 13,
  },
  listHeader: {
    marginBottom: 4,
  },
  entryRow: {
    gap: 8,
    paddingBottom: 16,
  },
  broadcastPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(220,43,43,0.12)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  broadcastPillLabel: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  minimizeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#4A1616',
    marginHorizontal: 20,
    marginBottom: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  minimizeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#DC2B2B',
  },
  minimizeBarAlert: {
    backgroundColor: '#331CA7',
  },
  minimizeDotAlert: {
    backgroundColor: '#fff',
  },
  minimizeLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  minimizeTimer: {
    fontSize: 12.5,
    fontVariant: ['tabular-nums'],
    opacity: 0.85,
  },
  liveEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#DC2B2B',
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  liveStrip: {
    gap: 10,
    paddingBottom: 20,
  },
  liveCard: {
    width: 148,
    height: 196,
    borderRadius: 16,
    overflow: 'hidden',
  },
  liveBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  liveBadgeLabel: {
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  liveCountPill: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  liveCountText: {
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
  liveCardFooter: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    gap: 4,
  },
  liveHostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liveHostMonogram: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveHostInitial: {
    fontSize: 10,
    fontWeight: '700',
  },
  liveHostName: {
    fontSize: 11,
    flex: 1,
    opacity: 0.9,
  },
  liveTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
});
