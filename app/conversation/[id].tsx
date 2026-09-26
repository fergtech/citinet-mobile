import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

import { ActionSheet } from '@/components/action-sheet';
import { EmojiPickerSheet } from '@/components/emoji-picker';
import { HubMedia } from '@/components/hub-media';
import { LinkPreviewCard } from '@/components/link-preview-card';
import { MediaLightbox } from '@/components/media-lightbox';
import { ReportSheet } from '@/components/report-sheet';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { blockMember, getMediaUrl, getMessages, listCallEvents, listConversations, markNotificationsForRef, sendMessage, toggleMessageReaction, uploadFilesWithProgress } from '@/lib/api/hubService';
import { CallEvent, CallMode, HubMessage, MessageAttachment, MessageReaction } from '@/lib/api/types';
import { useCall } from '@/lib/comms/call-context';
import { formatCallDuration, useElapsedSeconds } from '@/lib/comms/use-elapsed';
import { confirmDestructive } from '@/lib/ui/confirm';
import { useE2EKeys } from '@/lib/crypto/e2e-context';
import { FILE_KIND_META, fileKind } from '@/lib/files/kind';
import { guessMimeType } from '@/lib/files/mime';
import { saveFileToDevice } from '@/lib/files/save-to-device';
import { useSession } from '@/lib/session/session-context';
import { isEncryptedBody } from '@/lib/ui/encrypted-message';
import { parseMessageLinks } from '@/lib/ui/link-preview';
import { timeAgo } from '@/lib/ui/time-ago';

// Unifies expo-image-picker's ImagePickerAsset and expo-document-picker's
// DocumentPickerAsset into one shape the composer's staging tray works with
// — same simplification app/files/upload.tsx already uses for its own picker.
type PickedFile = { uri: string; name: string; mimeType: string; size?: number };

const EXT_FOR_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

const MAX_ATTACHMENTS = 10;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB — same cap citinet-web's composer enforces

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

// Image/video attachments render inline via HubMedia's private token-download
// path (message attachments upload is_public: false — see handleSend's own
// note on why that's now safe: the hub's file-access routes were fixed to
// also authorize any member of a conversation the file was shared into, not
// just the file's owner). Anything else (pdf, doc, zip, …) gets a tappable
// chip that downloads it straight to the device, same as Files section
// behavior.
function MessageAttachmentView({
  attachment,
  tunnelUrl,
  token,
  own,
  onOpenMedia,
}: {
  attachment: MessageAttachment;
  tunnelUrl: string;
  token: string;
  own: boolean;
  onOpenMedia: (fileName: string, kind: 'image' | 'video') => void;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const kind = fileKind(attachment.file_name, attachment.mime_type);
  const [saving, setSaving] = useState(false);

  if (kind === 'image' || kind === 'video') {
    return (
      // nativeControls={false}: without it, a tap on a video thumbnail would
      // be ambiguous between "toggle the inline play/pause overlay" and
      // "open the lightbox" — this makes tap always mean the latter.
      <Pressable onPress={() => onOpenMedia(attachment.file_name, kind)} accessibilityLabel={kind === 'video' ? 'Open video' : 'Open photo'} accessibilityRole="button">
        <HubMedia fileName={attachment.file_name} tunnelUrl={tunnelUrl} token={token} style={styles.attachmentMedia} nativeControls={false} />
      </Pressable>
    );
  }

  const meta = FILE_KIND_META[kind];

  async function handleOpen() {
    if (saving) return;
    setSaving(true);
    try {
      const url = await getMediaUrl(tunnelUrl, token, attachment.file_name);
      await saveFileToDevice(url, attachment.file_name, kind);
    } catch (err) {
      Alert.alert('Download failed', err instanceof Error ? err.message : "Couldn't download that file.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Pressable
      onPress={handleOpen}
      disabled={saving}
      style={[styles.fileChip, { borderColor: (own ? '#fff' : Colors[colorScheme].icon) + '33' }]}>
      {saving ? (
        <ActivityIndicator size="small" color={own ? '#fff' : Colors[colorScheme].icon} />
      ) : (
        <IconSymbol name={meta.icon} size={16} color={own ? '#fff' : meta.color} />
      )}
      <ThemedText numberOfLines={1} style={styles.fileChipName} lightColor={own ? '#fff' : undefined} darkColor={own ? '#fff' : undefined}>
        {attachment.file_name}
      </ThemedText>
    </Pressable>
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
  const insets = useSafeAreaInsets();
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
  const [stagedFiles, setStagedFiles] = useState<PickedFile[]>([]);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [uploadingFileCount, setUploadingFileCount] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showAttachSheet, setShowAttachSheet] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
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
  // Tap on an image/video attachment bubble (see MessageAttachmentView) —
  // opens MediaLightbox full-screen instead of the cropped inline preview.
  const [lightboxMedia, setLightboxMedia] = useState<{ fileName: string; kind: 'image' | 'video' } | null>(null);

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

  // Opening a conversation and seeing its latest message means every message
  // notification that led up to it has effectively already been seen too —
  // clears them all in one call rather than leaving the notifications screen
  // as the only place that can dismiss them, one tap per message. Fire-and-
  // forget, same as the read-receipt update GET .../messages already does
  // server-side for the "· Read" indicator (a separate mechanism — that one
  // tracks hub_conversation_members.last_read_at, this one hub_notifications).
  //
  // Scoped to 'message' specifically — a conversation can also carry
  // 'message_reaction' notifications sharing this same ref_id, and those are
  // tracked independently on purpose (see markNotificationsForRef's own
  // comment): just opening the thread to read new messages shouldn't also
  // silently dismiss a reaction notification nobody's actually acknowledged
  // yet. The one place that *can* clear a reaction notification is tapping
  // it directly on the notifications screen.
  useEffect(() => {
    if (!session) return;
    markNotificationsForRef(session.hub.tunnelUrl, session.token, id, 'message').catch(() => {});
  }, [session, id]);

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

  function addStagedFiles(files: PickedFile[]) {
    setStagedFiles((prev) => [...prev, ...files.filter((f) => (f.size ?? 0) <= MAX_FILE_SIZE)].slice(0, MAX_ATTACHMENTS));
  }

  async function handlePickMedia() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setError('Photo library permission is needed to attach a photo or video.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.7, allowsMultipleSelection: true });
    if (result.canceled) return;
    addStagedFiles(
      result.assets.map((asset, i) => {
        // `|| ` not `??` — some Android pickers return mimeType as '' (falsy
        // but not nullish), which would otherwise slip past a ?? fallback and
        // get stored server-side as a mimeType-less, unclassifiable file.
        const mimeType = asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg');
        const name = asset.fileName ?? `${asset.type === 'video' ? 'video' : 'photo'}-${Date.now()}-${i}.${EXT_FOR_MIME[mimeType] ?? 'jpg'}`;
        return { uri: asset.uri, name, mimeType, size: asset.fileSize };
      })
    );
    setError(null);
  }

  async function handleTakeMedia() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      setError('Camera permission is needed to capture a photo or video.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images', 'videos'], quality: 0.7 });
    if (result.canceled) return;
    const asset = result.assets[0];
    const mimeType = asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg');
    const name = asset.fileName ?? `${asset.type === 'video' ? 'video' : 'photo'}-${Date.now()}.${EXT_FOR_MIME[mimeType] ?? 'jpg'}`;
    addStagedFiles([{ uri: asset.uri, name, mimeType, size: asset.fileSize }]);
    setError(null);
  }

  async function handlePickFile() {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (result.canceled) return;
    addStagedFiles(
      result.assets.map((asset) => ({ uri: asset.uri, name: asset.name, mimeType: guessMimeType(asset.name, asset.mimeType), size: asset.size }))
    );
    setError(null);
  }

  function removeStagedFile(index: number) {
    setStagedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function insertEmoji(emoji: string) {
    setDraft((prev) => prev + emoji);
  }

  async function handleSend() {
    const text = draft.trim();
    const hasFiles = stagedFiles.length > 0;
    if (!session || (!text && !hasFiles) || sending) return;
    const filesToSend = stagedFiles;
    setDraft('');
    setStagedFiles([]);
    setSending(true);
    try {
      let attachmentIds: string[] | undefined;
      if (filesToSend.length > 0) {
        setUploadingAttachments(true);
        setUploadingFileCount(filesToSend.length);
        setUploadProgress(0);
        try {
          const uploaded = await uploadFilesWithProgress(
            session.hub.tunnelUrl,
            session.token,
            filesToSend.map((f) => ({ uri: f.uri, name: f.name, type: f.mimeType, size: f.size })),
            // is_public: false — matches citinet-web's own sendMessageWithMedia.
            // Viewing this still works for the recipient (not just the sender)
            // because the hub's file-access routes (GET /api/files/:filename,
            // POST /api/files/:filename/token, GET .../download) now also
            // authorize any member of a conversation the file was attached
            // into, not just the file's owner — see FILE_ACCESS_CONDITION in
            // api/server.js. Before that fix, is_public: false here meant a
            // DM recipient always 404'd trying to view an attachment the
            // *other* person sent.
            false,
            setUploadProgress
          );
          attachmentIds = uploaded.map((u) => u.file_id);
        } finally {
          setUploadingAttachments(false);
        }
      }
      const outgoingBody = text ? await encryptForConversation(id, peerId, text) : '';
      const sent = await sendMessage(session.hub.tunnelUrl, session.token, id, outgoingBody, attachmentIds);
      // POST .../messages' real response has no `reactions` field at all
      // (unlike GET .../messages, which aggregates it) — a fresh send would
      // otherwise be `undefined` here and crash the reaction row's `.length`
      // read. Same defensive default for `attachments`, which that response
      // also omits whenever there are none.
      setMessages((prev) => [...prev, { ...sent, reactions: sent.reactions ?? [], attachments: sent.attachments ?? [] }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message.');
      // Unlike a plain text retry (cheap to retype), redoing a camera shot or
      // file pick is real work — restore both instead of silently discarding
      // them, so a failed/timed-out upload just leaves the composer as it was.
      setDraft(text);
      setStagedFiles(filesToSend);
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
    // Explicit backgroundColor here, not left to ThemedView below — see
    // app/post/[id].tsx's identical comment for why: this is the view that
    // actually pads for the keyboard on iOS, so its bottom edge (not
    // ThemedView's) sits behind the keyboard's rounded top corners.
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: Colors[colorScheme].background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
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
            const isPlaceholder = encrypted && !resolved;
            const bodyText = !encrypted
              ? item.body
              : resolved
                ? resolved
                : resolved === null
                  ? "🔒 couldn't decrypt this message"
                  : '🔒 Encrypted message';
            // Links only get parsed out of real (decrypted/plaintext) content —
            // a still-encrypted placeholder string has nothing to link-ify.
            const { text: cleanText, urls } = isPlaceholder ? { text: bodyText, urls: [] as string[] } : parseMessageLinks(bodyText);
            const hasAttachments = !!item.attachments?.length;
            return (
              <View style={[styles.messageRow, own ? styles.messageRowOwn : styles.messageRowOther]}>
                {!own && (
                  <ThemedText style={styles.sender}>{item.sender_username ?? 'Citinet'}</ThemedText>
                )}
                {(!!cleanText || hasAttachments) && (
                  <Pressable
                    onLongPress={() => setReactionSheetMessageId(item.message_id)}
                    style={[
                      styles.bubble,
                      own
                        ? [styles.bubbleOwn, { backgroundColor: Brand }]
                        : [styles.bubbleOther, { borderColor: Colors[colorScheme].icon + '33' }],
                    ]}>
                    {!!cleanText && (
                      <ThemedText
                        style={isPlaceholder ? styles.encryptedText : undefined}
                        lightColor={own ? '#fff' : undefined}
                        darkColor={own ? '#fff' : undefined}>
                        {cleanText}
                      </ThemedText>
                    )}
                    {hasAttachments && (
                      <View style={[styles.attachmentsWrap, !!cleanText && styles.attachmentsWrapWithText]}>
                        {item.attachments.map((att) => (
                          <MessageAttachmentView
                            key={att.file_id}
                            attachment={att}
                            tunnelUrl={session.hub.tunnelUrl}
                            token={session.token}
                            own={own}
                            onOpenMedia={(fileName, kind) => setLightboxMedia({ fileName, kind })}
                          />
                        ))}
                      </View>
                    )}
                  </Pressable>
                )}
                {urls.map((url) => (
                  <LinkPreviewCard key={url} url={url} tunnelUrl={session.hub.tunnelUrl} />
                ))}
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
                          {/* A 1:1 DM only ever has one person's reaction on
                              a given emoji, so "❤️ 1" is just noise — the
                              count earns its place once a group chat member
                              stacks onto the same emoji (2+), same as it
                              already did before this. */}
                          {r.emoji}
                          {r.count > 1 ? ` ${r.count}` : ''}
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

        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 8 : 16) }]}>
          {uploadingAttachments && (
            <ThemedText style={styles.uploadStatus}>
              Uploading {uploadingFileCount > 1 ? `${uploadingFileCount} files… ` : '… '}{uploadProgress}%
            </ThemedText>
          )}
          {stagedFiles.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stagedRow} contentContainerStyle={styles.stagedRowContent}>
              {stagedFiles.map((file, index) => {
                const kind = fileKind(file.name, file.mimeType);
                const kindMeta = FILE_KIND_META[kind];
                return (
                  <View key={`${file.uri}-${index}`} style={styles.stagedItem}>
                    {kind === 'image' ? (
                      <Image source={{ uri: file.uri }} style={styles.stagedThumb} contentFit="cover" />
                    ) : kind === 'video' ? (
                      <View style={[styles.stagedThumb, styles.stagedVideoTile]}>
                        <IconSymbol name="play.fill" size={16} color="#fff" />
                      </View>
                    ) : (
                      <View style={[styles.stagedThumb, { backgroundColor: kindMeta.color }]}>
                        <IconSymbol name={kindMeta.icon} size={16} color="#fff" />
                      </View>
                    )}
                    <Pressable
                      onPress={() => removeStagedFile(index)}
                      style={styles.stagedRemove}
                      hitSlop={8}
                      accessibilityLabel={`Remove ${file.name}`}
                      accessibilityRole="button">
                      <IconSymbol name="xmark.circle.fill" size={16} color="#fff" />
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
          )}
          <View style={styles.composerRow}>
            <Pressable
              onPress={() => setShowAttachSheet(true)}
              disabled={sending}
              style={styles.composerIconButton}
              hitSlop={8}
              accessibilityLabel="Attach a photo, video, or file"
              accessibilityRole="button">
              <IconSymbol name="plus.circle.fill" size={26} color={Colors[colorScheme].icon} />
            </Pressable>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Message…"
              placeholderTextColor={Colors[colorScheme].icon}
              style={[styles.composerInput, { color: Colors[colorScheme].text }]}
              multiline
            />
            <Pressable
              onPress={() => setShowEmojiPicker(true)}
              style={styles.composerIconButton}
              hitSlop={8}
              accessibilityLabel="Insert an emoji"
              accessibilityRole="button">
              <IconSymbol name="face.smiling" size={22} color={Colors[colorScheme].icon} />
            </Pressable>
            <Pressable
              onPress={handleSend}
              disabled={sending || (!draft.trim() && stagedFiles.length === 0)}
              style={[styles.sendButton, { opacity: sending || (!draft.trim() && stagedFiles.length === 0) ? 0.4 : 1 }]}>
              <IconSymbol name="paperplane.fill" size={20} color={Colors[colorScheme].tint} />
            </Pressable>
          </View>
        </View>

        <ActionSheet
          visible={showAttachSheet}
          onClose={() => setShowAttachSheet(false)}
          options={[
            { key: 'media', label: 'Photo or video', icon: 'photo', onPress: handlePickMedia },
            { key: 'camera', label: 'Take photo or video', icon: 'camera.fill', onPress: handleTakeMedia },
            { key: 'file', label: 'Choose a file', icon: 'doc', onPress: handlePickFile },
          ]}
        />

        <EmojiPickerSheet visible={showEmojiPicker} onClose={() => setShowEmojiPicker(false)} onSelect={insertEmoji} />

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

        {lightboxMedia && (
          <MediaLightbox
            visible={!!lightboxMedia}
            onClose={() => setLightboxMedia(null)}
            fileName={lightboxMedia.fileName}
            kind={lightboxMedia.kind}
            tunnelUrl={session.hub.tunnelUrl}
            token={session.token}
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
  attachmentsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  attachmentsWrapWithText: {
    marginTop: 6,
  },
  attachmentMedia: {
    width: 220,
    height: 220,
    aspectRatio: undefined,
    borderRadius: 12,
  },
  fileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 8,
    maxWidth: 200,
  },
  fileChipName: {
    fontSize: 12.5,
    flexShrink: 1,
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
    // paddingBottom is applied inline (see the composer View itself) —
    // Math.max(insets.bottom, ...) so the home-indicator safe area on
    // iPhones with rounded bottom corners actually clears the placeholder
    // text instead of a fixed 8px letting the corner curve clip into it.
    // Same fix as app/post/[id].tsx's comment composer.
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
  composerIconButton: {
    paddingVertical: 8,
  },
  uploadStatus: {
    fontSize: 11.5,
    opacity: 0.6,
    marginBottom: 4,
  },
  stagedRow: {
    marginBottom: 8,
  },
  stagedRowContent: {
    gap: 8,
  },
  stagedItem: {
    width: 56,
    height: 56,
  },
  stagedThumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stagedVideoTile: {
    backgroundColor: '#000',
  },
  stagedRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 999,
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
    // Color-emoji glyphs render taller than the line height RN computes
    // from fontSize alone, clipping their tops inside the button's 48px
    // box otherwise — explicit headroom fixes it.
    lineHeight: 36,
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
