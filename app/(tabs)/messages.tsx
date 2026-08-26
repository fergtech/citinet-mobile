import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useScrollToTop } from '@react-navigation/native';

import { BrandGradient } from '@/components/brand-gradient';
import { HubAvatar } from '@/components/hub-avatar';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { listConversations } from '@/lib/api/hubService';
import { HubConversation } from '@/lib/api/types';
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

export default function MessagesScreen() {
  const { session } = useSession();
  const { ensure, attention, decryptForConversation } = useE2EKeys();
  // Only iOS's tab bar floats over content (see app/(tabs)/_layout.tsx) —
  // compensate so the last row doesn't end up hidden behind the glass.
  const tabBarHeight = useBottomTabBarHeight();
  const extraBottomInset = Platform.OS === 'ios' ? tabBarHeight : 0;
  const [conversations, setConversations] = useState<HubConversation[]>([]);
  const [previews, setPreviews] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          Messages
        </ThemedText>
      </View>

      {loading && conversations.length === 0 && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      <FlatList
        ref={listRef}
        data={conversations}
        keyExtractor={(item) => item.conversation_id}
        contentContainerStyle={[styles.list, { paddingBottom: 24 + extraBottomInset }]}
        onRefresh={load}
        refreshing={loading}
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
});
