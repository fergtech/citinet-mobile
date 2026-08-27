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
import { blockMember, getMessages, listCallEvents, listConversations, sendMessage, toggleMessageReaction } from '@/lib/api/hubService';
import { CallEvent, CallMode, HubMessage, MessageReaction } from '@/lib/api/types';
import { useCall } from '@/lib/comms/call-context';
import { formatCallDuration, useElapsedSeconds } from '@/lib/comms/use-elapsed';
import { confirmDestructive } from '@/lib/ui/confirm';
import { useE2EKeys } from '@/lib/crypto/e2e-context';
import { useSession } from '@/lib/session/session-context';
import { isEncryptedBody } from '@/lib/ui/encrypted-message';
import { timeAgo } from '@/lib/ui/time-ago';

type TimelineItem = { kind: 'message'; key: string; createdAt: string; message: HubMessage } | { kind: 'call'; key: string; createdAt: string; event: CallEvent };

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

// "Video call · 1:12" / "· not answered" — spec, verbatim. Duration is
// derived once from the row's own started_at/ended_at (a closed record by
// the time it's fetched), not the live elapsed-seconds hook that only
// applies to a call still in progress.
function CallEventChip({ event, selfId }: { event: CallEvent; selfId: string }) {
  const modeLabel = event.mode === 'video' ? 'Video call' : 'Audio call';
  let detail: string;
  if (event.outcome === 'connected' && event.started_at && event.ended_at) {
    const seconds = Math.max(0, Math.round((new Date(event.ended_at).getTime() - new Date(event.started_at).getTime()) / 1000));
    detail = formatCallDuration(seconds);
  } else if (event.outcome === 'declined') {
    detail = event.callee_id === selfId ? 'declined' : 'not answered';
  } else {
    detail = 'not answered';
  }
  return (
    <View style={styles.callChipRow}>
      <View style={styles.callChip}>
        <IconSymbol name={event.mode === 'video' ? 'video.fill' : 'phone.fill'} size={12} color="#8886" />
        <ThemedText style={styles.callChipText}>
          {modeLabel} · {detail}
        </ThemedText>
      </View>
    </View>
  );
}

// Own component so the elapsed-seconds tick (500ms, see use-elapsed.ts's own
// note on why) only re-renders this small bar, not the whole thread screen.
function MinimizedCallBar({ onPress }: { onPress: () => void }) {
  const { call } = useCall();
  const elapsed = useElapsedSeconds(call.startedAt);
  return (
    <Pressable onPress={onPress} style={styles.minimizeBar}>
      <View style={styles.minimizeDot} />
      <ThemedText style={styles.minimizeLabel} lightColor="#fff" darkColor="#fff">
        {call.mode === 'video' ? 'Video call in progress' : 'Call in progress'}
      </ThemedText>
      <ThemedText style={styles.minimizeTimer} lightColor="#fff" darkColor="#fff">
        {call.phase === 'outgoing' ? 'Ringing…' : formatCallDuration(elapsed)}
      </ThemedText>
      <IconSymbol name="chevron.up" size={14} color="#fff" />
    </Pressable>
  );
}

export default function ConversationScreen() {
  const { id, title, peerId: peerIdParam } = useLocalSearchParams<{ id: string; title: string; peerId?: string }>();
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const { ensure, attention, decryptForConversation, encryptForConversation } = useE2EKeys();
  const { call, restore } = useCall();
  const listRef = useRef<FlatList<TimelineItem>>(null);

  const [messages, setMessages] = useState<HubMessage[]>([]);
  const [callEvents, setCallEvents] = useState<CallEvent[]>([]);
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

  // Merged client-side by timestamp — there's no server-side merge of
  // hub_messages and hub_call_events (deliberately: call history got its own
  // small table rather than folding a "kind" discriminator into messages,
  // see api/comms.js's own note).
  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [
      ...messages.map((m) => ({ kind: 'message' as const, key: `m-${m.message_id}`, createdAt: m.created_at, message: m })),
      ...callEvents.map((c) => ({ kind: 'call' as const, key: `c-${c.id}`, createdAt: c.created_at, event: c })),
    ];
    return items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [messages, callEvents]);

  function handleStartCall(mode: CallMode) {
    if (!peerId || !title) return;
    router.push({ pathname: '/call/setup', params: { conversationId: id, peerId, peerName: title, mode } });
  }

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

  const loadCallEvents = useCallback(() => {
    if (!session) return;
    listCallEvents(session.hub.tunnelUrl, session.token, id).then(setCallEvents);
  }, [session, id]);

  useEffect(() => {
    loadCallEvents();
  }, [loadCallEvents]);

  // A call for this exact conversation just resolved — refetch so its
  // transcript chip ("Video call · 1:12") shows up without a manual pull.
  // A short extra refetch covers end()/decline() being fire-and-forget on
  // the server side (see hubService.ts's own note on that).
  useEffect(() => {
    if (call.phase === 'ended' && call.conversationId === id) {
      loadCallEvents();
      const timer = setTimeout(loadCallEvents, 1000);
      return () => clearTimeout(timer);
    }
  }, [call.phase, call.conversationId, id, loadCallEvents]);

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
          rightIcon2={!isGroup && peerId ? 'video.fill' : undefined}
          onRightPress2={!isGroup && peerId ? () => handleStartCall('video') : undefined}
          rightAccessibilityLabel2="Start video call"
          rightIcon3={!isGroup && peerId ? 'phone.fill' : undefined}
          onRightPress3={!isGroup && peerId ? () => handleStartCall('audio') : undefined}
          rightAccessibilityLabel3="Start audio call"
        />

        {/* Minimize keeps the call alive (components/comms/in-call-overlay.tsx
            stays mounted) — this bar is purely "come back to it," not a
            second copy of the call state. Only for a minimized call
            belonging to *this* conversation; other threads show nothing. */}
        {call.minimized && call.conversationId === id && (call.phase === 'connected' || call.phase === 'outgoing') && <MinimizedCallBar onPress={restore} />}

        {loading && messages.length === 0 && <ActivityIndicator style={styles.spinner} />}
        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        <FlatList
          ref={listRef}
          data={timeline}
          keyExtractor={(t) => t.key}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item: timelineItem }) => {
            if (timelineItem.kind === 'call') {
              return <CallEventChip event={timelineItem.event} selfId={session.userId} />;
            }
            const item = timelineItem.message;
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
  callChipRow: {
    alignItems: 'center',
    marginVertical: 6,
  },
  callChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#8882',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  callChipText: {
    fontSize: 12,
    opacity: 0.7,
  },
  minimizeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1B4D3E',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  minimizeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4ADE80',
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
});
