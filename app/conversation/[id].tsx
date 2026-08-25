import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getMessages, listConversations, sendMessage } from '@/lib/api/hubService';
import { HubMessage } from '@/lib/api/types';
import { useE2EKeys } from '@/lib/crypto/e2e-context';
import { useSession } from '@/lib/session/session-context';
import { isEncryptedBody } from '@/lib/ui/encrypted-message';
import { timeAgo } from '@/lib/ui/time-ago';

export default function ConversationScreen() {
  const { id, title, peerId: peerIdParam } = useLocalSearchParams<{ id: string; title: string; peerId?: string }>();
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const { ensure, attention, decryptForConversation, encryptForConversation } = useE2EKeys();
  const listRef = useRef<FlatList<HubMessage>>(null);

  const [messages, setMessages] = useState<HubMessage[]>([]);
  const [decrypted, setDecrypted] = useState<Map<string, string | null>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [isGroup, setIsGroup] = useState(false);
  // Real read receipts: GET /api/conversations/:id/messages (called by load()
  // above) already marks *this device's* read position server-side as a side
  // effect — confirmed directly in api/server.js, nothing extra to send for
  // that half. This is the other half: the peer's own last_read_at, which
  // only the conversations LIST endpoint returns (no single-conversation
  // detail route exists), so it's fetched separately here.
  const [peerLastReadAt, setPeerLastReadAt] = useState<string | null>(null);

  // A conversation reached via Messages carries the peer id already; a
  // hypothetical deep link that skips that screen falls back to deriving it
  // from whoever isn't us in the loaded messages.
  const peerId = useMemo(() => {
    if (peerIdParam) return peerIdParam;
    if (!session) return null;
    return messages.find((m) => m.sender_id !== session.userId)?.sender_id ?? null;
  }, [peerIdParam, messages, session]);

  // Only the most recent message you sent shows a read receipt (same
  // convention as iMessage/WhatsApp — not one per message).
  const lastOwnMessageId = useMemo(() => {
    if (!session) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender_id === session.userId) return messages[i].message_id;
    }
    return null;
  }, [messages, session]);

  const load = useCallback(() => {
    if (!session) return;
    setLoading(true);
    setError(null);
    getMessages(session.hub.tunnelUrl, session.token, id)
      .then(setMessages)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load.'))
      .finally(() => setLoading(false));
  }, [session, id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    listConversations(session.hub.tunnelUrl, session.token)
      .then((all) => {
        if (cancelled) return;
        const convo = all.find((c) => c.conversation_id === id);
        const peer = convo?.members.find((m) => m.user_id !== session.userId);
        setIsGroup(convo?.kind === 'group');
        setPeerLastReadAt(peer?.last_read_at ?? null);
      })
      .catch(() => {
        // Read receipts are a nice-to-have, not core to sending/receiving —
        // fail quietly rather than surfacing an error banner over the thread.
      });
    return () => {
      cancelled = true;
    };
  }, [session, id]);

  useEffect(() => {
    ensure();
  }, [ensure]);

  useEffect(() => {
    if (attention) router.push((attention === 'unlock' ? '/e2e-unlock' : '/e2e-setup') as Href);
  }, [attention]);

  // Batch decrypt whenever the message list changes (including right after
  // handleSend's optimistic append — that message is still the raw ciphertext
  // the server echoed back, it needs the same pass as loaded messages).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = new Map<string, string | null>();
      for (const msg of messages) {
        if (!isEncryptedBody(msg.body)) continue;
        const plain = await decryptForConversation(id, peerId, msg.body);
        next.set(msg.message_id, plain);
      }
      if (!cancelled) setDecrypted(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [messages, peerId, id, decryptForConversation]);

  async function handleSend() {
    if (!session || !draft.trim()) return;
    const text = draft.trim();
    setDraft('');
    setSending(true);
    try {
      const outgoingBody = await encryptForConversation(id, peerId, text);
      const sent = await sendMessage(session.hub.tunnelUrl, session.token, id, outgoingBody);
      setMessages((prev) => [...prev, sent]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message.');
    } finally {
      setSending(false);
    }
  }

  if (!session) return null;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}>
      <ThemedView style={styles.flex}>
        <ScreenHeader
          title={title ?? 'Conversation'}
          onTitlePress={
            isGroup
              ? () => router.push({ pathname: '/group-members', params: { id, title: title ?? 'Group' } })
              : undefined
          }
        />

        {loading && messages.length === 0 && <ActivityIndicator style={styles.spinner} />}
        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.message_id}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            const own = item.sender_id === session.userId;
            const encrypted = isEncryptedBody(item.body);
            const resolved = decrypted.get(item.message_id);
            const bodyText = !encrypted
              ? item.body
              : resolved
                ? resolved
                : resolved === null
                  ? "🔒 couldn't decrypt this message"
                  : '🔒 Encrypted message';
            return (
              <View style={[styles.messageRow, own ? styles.messageRowOwn : styles.messageRowOther]}>
                {!own && (
                  <ThemedText style={styles.sender}>{item.sender_username ?? 'Citinet'}</ThemedText>
                )}
                <View
                  style={[
                    styles.bubble,
                    own
                      ? [styles.bubbleOwn, { backgroundColor: Brand }]
                      : [styles.bubbleOther, { borderColor: Colors[colorScheme].icon + '33' }],
                  ]}>
                  <ThemedText
                    style={encrypted && !resolved ? styles.encryptedText : undefined}
                    lightColor={own ? '#fff' : undefined}
                    darkColor={own ? '#fff' : undefined}>
                    {bodyText}
                  </ThemedText>
                </View>
                <ThemedText style={styles.time}>
                  {timeAgo(item.created_at)}
                  {own &&
                  item.message_id === lastOwnMessageId &&
                  peerLastReadAt &&
                  new Date(peerLastReadAt) >= new Date(item.created_at)
                    ? ' · Read'
                    : ''}
                </ThemedText>
              </View>
            );
          }}
          ListEmptyComponent={
            !loading ? <ThemedText style={styles.empty}>No messages yet — say hello.</ThemedText> : null
          }
        />

        <View style={styles.composer}>
          <View style={styles.composerRow}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Message…"
              placeholderTextColor={Colors[colorScheme].icon}
              style={[styles.composerInput, { color: Colors[colorScheme].text }]}
              multiline
            />
            <Pressable
              onPress={handleSend}
              disabled={sending || !draft.trim()}
              style={[styles.sendButton, { opacity: sending || !draft.trim() ? 0.4 : 1 }]}>
              <IconSymbol name="paperplane.fill" size={20} color={Colors[colorScheme].tint} />
            </Pressable>
          </View>
        </View>
      </ThemedView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
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
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 10,
  },
  empty: {
    opacity: 0.6,
    fontSize: 13,
    paddingHorizontal: 4,
  },
  messageRow: {
    maxWidth: '80%',
    gap: 2,
  },
  messageRowOwn: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  messageRowOther: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  sender: {
    fontSize: 12,
    opacity: 0.6,
    marginLeft: 4,
  },
  bubble: {
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  bubbleOwn: {
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomLeftRadius: 4,
  },
  encryptedText: {
    fontStyle: 'italic',
    opacity: 0.8,
  },
  time: {
    fontSize: 11,
    opacity: 0.45,
    marginHorizontal: 4,
  },
  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#8884',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 8 : 16,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  composerInput: {
    flex: 1,
    fontSize: 15,
    maxHeight: 100,
    paddingVertical: 8,
  },
  sendButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
});
