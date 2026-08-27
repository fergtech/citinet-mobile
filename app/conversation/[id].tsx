import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';

import { ActionSheet } from '@/components/action-sheet';
import { ReportSheet } from '@/components/report-sheet';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { blockMember, getMessages, listConversations, sendMessage, toggleMessageReaction } from '@/lib/api/hubService';
import { HubMessage, MessageReaction } from '@/lib/api/types';
import { confirmDestructive } from '@/lib/ui/confirm';
import { useE2EKeys } from '@/lib/crypto/e2e-context';
import { useSession } from '@/lib/session/session-context';
import { isEncryptedBody } from '@/lib/ui/encrypted-message';
import { timeAgo } from '@/lib/ui/time-ago';

// Real, already-working infra (see toggleMessageReaction's own note) —
// "like, heart, smile, laugh, something else" per the product ask, mapped to
// 5 single-glyph emoji (the server 400s past 4 UTF-16 code units per emoji).
const REACTION_EMOJI = ['👍', '❤️', '😊', '😂', '🎉'];

// Adjusts the emoji's own entry (add/increment/decrement/remove) without
// waiting on the network — replaced with the server's authoritative array
// once toggleMessageReaction resolves (see handleToggleReaction), so this
// only has to be approximately right for the instant before that lands.
function applyReactionToggle(reactions: MessageReaction[], emoji: string): MessageReaction[] {
  const existing = reactions.find((r) => r.emoji === emoji);
  if (!existing) return [...reactions, { emoji, count: 1, reacted_by_me: true }];
  if (!existing.reacted_by_me) return reactions.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, reacted_by_me: true } : r));
  if (existing.count <= 1) return reactions.filter((r) => r.emoji !== emoji);
  return reactions.map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, reacted_by_me: false } : r));
}

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
  const [showActions, setShowActions] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportMessageId, setReportMessageId] = useState<string | null>(null);
  // Long-press on any bubble (own or not) opens this instead of going
  // straight to Report the way it used to for other people's messages —
  // the reaction row now owns that gesture, with Report demoted to a row
  // inside the same sheet (see the sheet's own render below).
  const [reactionSheetMessageId, setReactionSheetMessageId] = useState<string | null>(null);

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

  function handleBlockPeer() {
    if (!session || !peerId) return;
    confirmDestructive(
      `Block ${title ?? 'this user'}? They won't be able to message you, and you won't see their posts or listings.`,
      'Block',
      () => {
        blockMember(session.hub.tunnelUrl, session.token, peerId)
          .then(() => router.back())
          .catch((err) => setError(err instanceof Error ? err.message : "Couldn't block that member."));
      }
    );
  }

  async function handleSend() {
    if (!session || !draft.trim()) return;
    const text = draft.trim();
    setDraft('');
    setSending(true);
    try {
      const outgoingBody = await encryptForConversation(id, peerId, text);
      const sent = await sendMessage(session.hub.tunnelUrl, session.token, id, outgoingBody);
      // POST .../messages' real response has no `reactions` field at all
      // (unlike GET .../messages, which aggregates it) — a fresh send would
      // otherwise be `undefined` here and crash the reaction row's `.length`
      // read. Same defensive default for `attachments`, which that response
      // also omits whenever there are none.
      setMessages((prev) => [...prev, { ...sent, reactions: sent.reactions ?? [], attachments: sent.attachments ?? [] }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message.');
    } finally {
      setSending(false);
    }
  }

  function handleToggleReaction(messageId: string, emoji: string) {
    if (!session) return;
    setReactionSheetMessageId(null);
    const previous = messages;
    setMessages((prev) =>
      prev.map((m) => (m.message_id === messageId ? { ...m, reactions: applyReactionToggle(m.reactions, emoji) } : m))
    );
    toggleMessageReaction(session.hub.tunnelUrl, session.token, messageId, emoji)
      .then((result) => {
        setMessages((prev) => prev.map((m) => (m.message_id === messageId ? { ...m, reactions: result.reactions } : m)));
      })
      .catch(() => {
        setMessages(previous);
      });
  }

  const reactionSheetMessage = messages.find((m) => m.message_id === reactionSheetMessageId) ?? null;

  if (!session) return null;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ThemedView style={styles.flex}>
        <ScreenHeader
          title={title ?? 'Conversation'}
          onTitlePress={
            isGroup
              ? () => router.push({ pathname: '/group-members', params: { id, title: title ?? 'Group' } })
              : undefined
          }
          rightIcon={!isGroup && peerId ? 'ellipsis.circle.fill' : undefined}
          onRightPress={!isGroup && peerId ? () => setShowActions(true) : undefined}
          rightAccessibilityLabel="More actions"
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
                <Pressable
                  onLongPress={() => setReactionSheetMessageId(item.message_id)}
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
                </Pressable>
                {item.reactions.length > 0 && (
                  <View style={styles.reactionRow}>
                    {item.reactions.map((r) => (
                      <Pressable
                        key={r.emoji}
                        onPress={() => handleToggleReaction(item.message_id, r.emoji)}
                        style={[
                          styles.reactionPill,
                          { borderColor: Colors[colorScheme].icon + '33' },
                          r.reacted_by_me && { backgroundColor: Brand + '22', borderColor: Brand },
                        ]}>
                        <ThemedText style={styles.reactionPillText}>
                          {r.emoji} {r.count}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </View>
                )}
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

        {peerId && (
          <ActionSheet
            visible={showActions}
            onClose={() => setShowActions(false)}
            options={[
              {
                key: 'report',
                label: `Report ${title ?? 'this user'}`,
                icon: 'flag.fill',
                onPress: () => setShowReport(true),
              },
              {
                key: 'block',
                label: `Block ${title ?? 'this user'}`,
                icon: 'exclamationmark.octagon.fill',
                destructive: true,
                onPress: handleBlockPeer,
              },
            ]}
          />
        )}

        {peerId && (
          <ReportSheet
            visible={showReport}
            onClose={() => setShowReport(false)}
            tunnelUrl={session.hub.tunnelUrl}
            token={session.token}
            targetType="member"
            targetId={peerId}
          />
        )}

        {reportMessageId && (
          <ReportSheet
            visible={!!reportMessageId}
            onClose={() => setReportMessageId(null)}
            tunnelUrl={session.hub.tunnelUrl}
            token={session.token}
            targetType="message"
            targetId={reportMessageId}
          />
        )}

        {/* Long-press on any bubble — reaction row up top (own messages can
            react to themselves too, same as iMessage/Discord/Slack), plus a
            Report row underneath for other people's messages only. Not
            components/action-sheet.tsx: that only renders a plain list of
            labeled rows, no way to fit a horizontal emoji row above them. */}
        <Modal
          visible={!!reactionSheetMessage}
          transparent
          animationType="fade"
          onRequestClose={() => setReactionSheetMessageId(null)}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setReactionSheetMessageId(null)}>
            <Pressable onPress={() => {}} style={[styles.sheet, { backgroundColor: Colors[colorScheme].background }]}>
              <View style={styles.reactionPickerRow}>
                {REACTION_EMOJI.map((emoji) => (
                  <Pressable
                    key={emoji}
                    onPress={() => reactionSheetMessage && handleToggleReaction(reactionSheetMessage.message_id, emoji)}
                    style={styles.reactionPickerButton}
                    hitSlop={6}>
                    <ThemedText style={styles.reactionPickerEmoji}>{emoji}</ThemedText>
                  </Pressable>
                ))}
              </View>
              {reactionSheetMessage && reactionSheetMessage.sender_id !== session.userId && (
                <>
                  <View style={[styles.divider, { backgroundColor: Colors[colorScheme].icon + '22' }]} />
                  <Pressable
                    onPress={() => {
                      const id = reactionSheetMessage.message_id;
                      setReactionSheetMessageId(null);
                      setReportMessageId(id);
                    }}
                    style={styles.sheetRow}>
                    <IconSymbol name="flag.fill" size={18} color={Colors[colorScheme].text} />
                    <ThemedText style={styles.sheetRowLabel}>Report this message</ThemedText>
                  </Pressable>
                </>
              )}
              <View style={[styles.divider, { backgroundColor: Colors[colorScheme].icon + '22' }]} />
              <Pressable onPress={() => setReactionSheetMessageId(null)} style={styles.sheetRow}>
                <ThemedText style={styles.sheetRowLabel}>Cancel</ThemedText>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
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
  reactionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 2,
  },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  reactionPillText: {
    fontSize: 12.5,
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
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    paddingBottom: 36,
    paddingHorizontal: 8,
  },
  reactionPickerRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    paddingHorizontal: 8,
    paddingBottom: 12,
  },
  reactionPickerButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionPickerEmoji: {
    fontSize: 28,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  sheetRowLabel: {
    fontSize: 15.5,
  },
});
