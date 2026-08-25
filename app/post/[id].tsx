import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { HubAvatar } from '@/components/hub-avatar';
import { HubMedia } from '@/components/hub-media';
import { EventAtlasLink } from '@/components/event-atlas-link';
import { EventRsvpButton } from '@/components/event-rsvp-button';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { PollCard } from '@/components/poll-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { createReply, getPost, listAttendees, listReplies, toggleLike, toggleRsvp, votePoll } from '@/lib/api/hubService';
import { EventAttendee, HubPost, HubPostReply } from '@/lib/api/types';
import { formatEventWhen } from '@/lib/ui/format-event';
import { applyVote } from '@/lib/ui/poll';
import { useSession } from '@/lib/session/session-context';
import { goToProfile } from '@/lib/ui/navigate-to-profile';
import { timeAgo } from '@/lib/ui/time-ago';

type ReplyNode = HubPostReply & { children: ReplyNode[] };

function buildReplyTree(replies: HubPostReply[]): ReplyNode[] {
  const nodes = new Map<string, ReplyNode>();
  replies.forEach((r) => nodes.set(r.id, { ...r, children: [] }));

  const roots: ReplyNode[] = [];
  nodes.forEach((node) => {
    const parent = node.reply_to_reply_id ? nodes.get(node.reply_to_reply_id) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      // top-level, or an orphaned reply-to-id we don't have — surface it rather than drop it
      roots.push(node);
    }
  });
  return roots;
}

const MAX_INDENT_DEPTH = 4;

function CommentNode({
  node,
  depth,
  tunnelUrl,
  onReply,
}: {
  node: ReplyNode;
  depth: number;
  tunnelUrl: string;
  onReply: (replyId: string, username: string | null, authorId: string | null) => void;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const tint = Colors[colorScheme].tint;
  const { session } = useSession();
  const indent = Math.min(depth, MAX_INDENT_DEPTH) * 16;

  return (
    <View style={{ marginLeft: indent }}>
      <View style={styles.commentRow}>
        <Pressable onPress={() => session && goToProfile(node.author_id, session.userId)}>
          <HubAvatar userId={node.author_id} displayName={node.author_username ?? '?'} tunnelUrl={tunnelUrl} size={28} />
        </Pressable>
        <View style={styles.commentBody}>
          <Pressable onPress={() => session && goToProfile(node.author_id, session.userId)}>
            <ThemedText type="defaultSemiBold" style={styles.commentAuthor}>
              {node.author_username ?? 'Citinet'}
            </ThemedText>
          </Pressable>
          {node.reply_to_username && (
            <ThemedText style={styles.replyingTo}>replying to @{node.reply_to_username}</ThemedText>
          )}
          <ThemedText style={styles.commentText}>{node.body}</ThemedText>
          <View style={styles.commentMetaRow}>
            <ThemedText style={styles.rowMeta}>{timeAgo(node.created_at)}</ThemedText>
            <Pressable onPress={() => onReply(node.id, node.author_username, node.author_id)}>
              <ThemedText style={[styles.replyAction, { color: tint }]}>Reply</ThemedText>
            </Pressable>
          </View>
        </View>
      </View>
      {node.children.map((child) => (
        <CommentNode key={child.id} node={child} depth={depth + 1} tunnelUrl={tunnelUrl} onReply={onReply} />
      ))}
    </View>
  );
}

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colorScheme = useColorScheme() ?? 'light';
  const tint = Colors[colorScheme].tint;
  const { session } = useSession();
  const inputRef = useRef<TextInput>(null);

  const [post, setPost] = useState<HubPost | null>(null);
  const [replies, setReplies] = useState<HubPostReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [replyTarget, setReplyTarget] = useState<{
    id: string;
    username: string | null;
    authorId: string | null;
  } | null>(null);
  // Loaded lazily on first tap of "See who's going," not alongside the
  // post/replies — most viewers never open it, no reason to fetch it upfront.
  // `attendees` is a cache (fetched once, kept across toggles); `showAttendees`
  // is just the fold/unfold state, so hiding the list doesn't discard it.
  const [attendees, setAttendees] = useState<EventAttendee[] | null>(null);
  const [loadingAttendees, setLoadingAttendees] = useState(false);
  const [showAttendees, setShowAttendees] = useState(false);

  const load = useCallback(() => {
    if (!session) return;
    setLoading(true);
    setError(null);
    Promise.all([
      getPost(session.hub.tunnelUrl, session.token, id),
      listReplies(session.hub.tunnelUrl, session.token, id),
    ])
      .then(([nextPost, nextReplies]) => {
        setPost(nextPost);
        setReplies(nextReplies);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load.'))
      .finally(() => setLoading(false));
  }, [session, id]);

  // Focus-based, not mount-only — see Home/Messages for why (e.g. a new
  // reply from someone else while you were on a commenter's profile).
  useFocusEffect(load);

  const tree = useMemo(() => buildReplyTree(replies), [replies]);

  function handleToggleLike() {
    if (!session || !post) return;
    const wasLiked = post.my_liked;
    setPost({ ...post, my_liked: !wasLiked, like_count: post.like_count + (wasLiked ? -1 : 1) });
    toggleLike(session.hub.tunnelUrl, session.token, post.id).catch(() => {
      setPost((prev) => (prev ? { ...prev, my_liked: wasLiked, like_count: prev.like_count } : prev));
    });
  }

  function handleVotePoll(current: HubPost, optionIndex: number) {
    if (!session) return;
    const prevPoll = current.poll;
    setPost((prev) => (prev ? applyVote(prev, optionIndex) : prev));
    votePoll(session.hub.tunnelUrl, session.token, current.id, optionIndex).catch(() => {
      setPost((prev) => (prev ? { ...prev, poll: prevPoll } : prev));
    });
  }

  function handleToggleRsvp() {
    if (!session || !post) return;
    const wasGoing = post.my_rsvp;
    setPost({ ...post, my_rsvp: !wasGoing, rsvp_count: post.rsvp_count + (wasGoing ? -1 : 1) });
    toggleRsvp(session.hub.tunnelUrl, session.token, post.id).catch(() => {
      setPost((prev) => (prev ? { ...prev, my_rsvp: wasGoing, rsvp_count: prev.rsvp_count } : prev));
    });
  }

  function handleToggleAttendees() {
    if (showAttendees) {
      setShowAttendees(false);
      return;
    }
    setShowAttendees(true);
    if (attendees || !session || !post) return;
    setLoadingAttendees(true);
    listAttendees(session.hub.tunnelUrl, session.token, post.id)
      .then(setAttendees)
      .catch(() => setAttendees([]))
      .finally(() => setLoadingAttendees(false));
  }

  function handleReplyTap(replyId: string, username: string | null, authorId: string | null) {
    setReplyTarget({ id: replyId, username, authorId });
    inputRef.current?.focus();
  }

  async function handleSubmitReply() {
    if (!session || !replyText.trim()) return;
    setSubmitting(true);
    try {
      await createReply(
        session.hub.tunnelUrl,
        session.token,
        id,
        replyText.trim(),
        replyTarget?.id ?? null,
        replyTarget?.authorId ?? null
      );
      setReplyText('');
      setReplyTarget(null);
      const nextReplies = await listReplies(session.hub.tunnelUrl, session.token, id);
      setReplies(nextReplies);
      setPost((prev) => (prev ? { ...prev, reply_count: nextReplies.length } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post reply.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!session) return null;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}>
      <ThemedView style={styles.flex}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back" accessibilityRole="button">
            <IconSymbol name="chevron.left" size={24} color={Colors[colorScheme].text} />
          </Pressable>
        </View>

        {loading && <ActivityIndicator style={styles.spinner} />}
        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        {post && (
          <FlatList
            data={tree}
            keyExtractor={(node) => node.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <CommentNode node={item} depth={0} tunnelUrl={session.hub.tunnelUrl} onReply={handleReplyTap} />
            )}
            ListHeaderComponent={
              <View style={styles.postSection}>
                <Pressable
                  style={styles.commentRow}
                  onPress={() => goToProfile(post.author_id, session.userId)}>
                  <HubAvatar
                    userId={post.author_id}
                    displayName={post.author_username ?? '?'}
                    tunnelUrl={session.hub.tunnelUrl}
                    size={38}
                  />
                  <View style={styles.commentBody}>
                    <ThemedText type="defaultSemiBold">{post.author_username ?? 'Citinet'}</ThemedText>
                    <ThemedText style={styles.rowMeta}>
                      {post.category.charAt(0) + post.category.slice(1).toLowerCase()} · {timeAgo(post.created_at)}
                    </ThemedText>
                  </View>
                </Pressable>
                {post.category === 'EVENT' && post.event_date && (
                  <View style={styles.eventLine}>
                    <IconSymbol name="calendar" size={14} color={Brand} />
                     <ThemedText style={[styles.eventLineText, { color: Brand }]}>
                      {formatEventWhen(post.event_date)}
                    </ThemedText>
                  </View>
                )}
                {post.title && (
                  <ThemedText type="defaultSemiBold" style={styles.postTitle}>
                    {post.title}
                  </ThemedText>
                )}
                <ThemedText style={styles.postBody}>{post.body}</ThemedText>
                {post.media_file_name && (
                  <View style={styles.mediaWrap}>
                    <HubMedia fileName={post.media_file_name} tunnelUrl={session.hub.tunnelUrl} token={session.token} />
                  </View>
                )}
                {post.category === 'POLL' && post.poll && (
                  <View style={styles.pollWrap}>
                    <PollCard post={post} onVote={handleVotePoll} />
                  </View>
                )}
                {post.category === 'EVENT' && post.event_location && (
                  <View style={styles.eventAtlasLinkWrap}>
                    <EventAtlasLink location={post.event_location} eventTitle={post.title} eventId={post.id} />
                  </View>
                )}
                {post.category === 'EVENT' && (
                  <View style={styles.rsvpSection}>
                    <EventRsvpButton post={post} onToggle={handleToggleRsvp} large />
                    {post.rsvp_count > 0 && (
                      <Pressable onPress={handleToggleAttendees} hitSlop={8}>
                        <ThemedText style={[styles.attendeesLink, { color: Brand }]}>
                          {showAttendees ? 'Hide attendees' : "See who's going"}
                        </ThemedText>
                      </Pressable>
                    )}
                    {showAttendees && (
                      <View style={styles.attendeesList}>
                        {loadingAttendees && <ActivityIndicator size="small" />}
                        {attendees?.map((attendee) => (
                          <ThemedText key={attendee.user_id} style={styles.attendeeRow} numberOfLines={1}>
                            {attendee.display_name || attendee.username}
                          </ThemedText>
                        ))}
                      </View>
                    )}
                  </View>
                )}
                <View style={styles.postFooter}>
                  <Pressable onPress={handleToggleLike} style={styles.likeButton} hitSlop={8}>
                    <IconSymbol
                      name={post.my_liked ? 'heart.fill' : 'heart'}
                      size={20}
                      color={post.my_liked ? '#d1465f' : Colors[colorScheme].icon}
                    />
                    <ThemedText style={styles.rowMeta}>{post.like_count}</ThemedText>
                  </Pressable>
                  <ThemedText style={styles.rowMeta}>{post.reply_count} comments</ThemedText>
                </View>
                <ThemedText style={styles.commentsHeading}>Comments</ThemedText>
              </View>
            }
            ListEmptyComponent={
              !loading ? <ThemedText style={styles.rowMeta}>No comments yet.</ThemedText> : null
            }
          />
        )}

        <View style={styles.composer}>
          {replyTarget && (
            <View style={styles.replyChip}>
              <ThemedText style={styles.rowMeta}>Replying to @{replyTarget.username ?? 'user'}</ThemedText>
              <Pressable onPress={() => setReplyTarget(null)} hitSlop={8}>
                <IconSymbol name="xmark" size={14} color={Colors[colorScheme].icon} />
              </Pressable>
            </View>
          )}
          <View style={styles.composerRow}>
            <TextInput
              ref={inputRef}
              value={replyText}
              onChangeText={setReplyText}
              placeholder="Add a comment…"
              placeholderTextColor={Colors[colorScheme].icon}
              style={[styles.composerInput, { color: Colors[colorScheme].text }]}
              multiline
            />
            <Pressable
              onPress={handleSubmitReply}
              disabled={submitting || !replyText.trim()}
              style={[styles.sendButton, { opacity: submitting || !replyText.trim() ? 0.4 : 1 }]}>
              <ThemedText style={{ color: tint, fontWeight: '600' }}>Send</ThemedText>
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
  header: {
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
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
    paddingBottom: 24,
  },
  postSection: {
    marginBottom: 8,
  },
  commentRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  commentBody: {
    flex: 1,
    gap: 2,
  },
  eventLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  eventLineText: {
    fontSize: 13.5,
    fontWeight: '600',
  },
  postTitle: {
    fontSize: 17,
    marginBottom: 6,
  },
  postBody: {
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 12,
  },
  mediaWrap: {
    marginBottom: 12,
  },
  eventAtlasLinkWrap: {
    marginBottom: 12,
  },
  rsvpSection: {
    gap: 10,
    marginBottom: 12,
  },
  attendeesLink: {
    fontSize: 13,
    fontWeight: '600',
  },
  attendeesList: {
    gap: 6,
    paddingLeft: 4,
  },
  attendeeRow: {
    fontSize: 14,
    opacity: 0.8,
  },
  pollWrap: {
    marginBottom: 12,
  },
  postFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#8884',
  },
  likeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  commentsHeading: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 4,
  },
  commentAuthor: {
    fontSize: 14,
  },
  replyingTo: {
    fontSize: 12,
    opacity: 0.6,
    fontStyle: 'italic',
  },
  commentText: {
    fontSize: 14.5,
    lineHeight: 20,
    marginTop: 2,
  },
  commentMetaRow: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 4,
  },
  rowMeta: {
    opacity: 0.6,
    fontSize: 13,
  },
  replyAction: {
    fontSize: 13,
    fontWeight: '600',
  },
  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#8884',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 8 : 16,
  },
  replyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
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
