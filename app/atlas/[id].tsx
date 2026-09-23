import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { router, useLocalSearchParams, type Href } from 'expo-router';

import { LeafletMap } from '@/components/atlas/leaflet-map';
import { EventRsvpButton } from '@/components/event-rsvp-button';
import { HubAvatar } from '@/components/hub-avatar';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  createAtlasPinReply,
  deleteAtlasPin,
  getMediaUrl,
  getPost,
  listAtlasPinReplies,
  listAtlasPins,
  toggleRsvp,
} from '@/lib/api/hubService';
import { AtlasPin, AtlasPinReply, HubPost } from '@/lib/api/types';
import { ATLAS_CATEGORIES } from '@/lib/atlas/categories';
import { openDirections } from '@/lib/atlas/directions';
import { distanceMeters, formatDistanceMiles } from '@/lib/atlas/geocoding';
import { useHubCenter } from '@/lib/atlas/hub-center';
import { findNearestPanoramaxImage, type PanoramaxImage } from '@/lib/atlas/panoramax';
import { fetchPlacePhoto, type PlacePhoto } from '@/lib/atlas/place-photo';
import { useSavedPins } from '@/lib/atlas/saved-pins';
import { FILE_KIND_META, fileKind, formatBytes } from '@/lib/files/kind';
import { useSession } from '@/lib/session/session-context';
import { confirmDestructive } from '@/lib/ui/confirm';
import { formatEventWhen } from '@/lib/ui/format-event';
import { goToProfile } from '@/lib/ui/navigate-to-profile';
import { timeAgo } from '@/lib/ui/time-ago';

type ReplyNode = AtlasPinReply & { children: ReplyNode[] };

function buildReplyTree(replies: AtlasPinReply[]): ReplyNode[] {
  const nodes = new Map<string, ReplyNode>();
  replies.forEach((r) => nodes.set(r.id, { ...r, children: [] }));

  const roots: ReplyNode[] = [];
  nodes.forEach((node) => {
    const parent = node.reply_to_reply_id ? nodes.get(node.reply_to_reply_id) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

function countDescendants(node: ReplyNode): number {
  return node.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0);
}

// Same threading UI as app/post/[id].tsx's comment section (that file's
// CommentNode isn't exported, so this is a pin-scoped copy rather than a
// shared import) — auto-collapses past this depth so a deep back-and-forth
// doesn't turn into an unreadable wall on a phone-width screen.
const AUTO_COLLAPSE_DEPTH = 3;

function avatarSizeForDepth(depth: number): number {
  return depth === 0 ? 28 : depth === 1 ? 25 : 22;
}

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
  const [expanded, setExpanded] = useState(depth + 1 < AUTO_COLLAPSE_DEPTH);
  const hasChildren = node.children.length > 0;
  const descendantCount = hasChildren && !expanded ? countDescendants(node) : 0;

  return (
    <View>
      <View style={styles.commentRow}>
        <Pressable onPress={() => session && goToProfile(node.author_id, session.userId)}>
          <HubAvatar userId={node.author_id} displayName={node.author_username ?? '?'} tunnelUrl={tunnelUrl} size={avatarSizeForDepth(depth)} />
        </Pressable>
        <View style={styles.commentBody}>
          <Pressable onPress={() => session && goToProfile(node.author_id, session.userId)}>
            <ThemedText type="defaultSemiBold" style={styles.commentAuthor}>
              {node.author_username ?? 'Citinet'}
            </ThemedText>
          </Pressable>
          {node.reply_to_username && (
            <View style={styles.replyingToPill}>
              <ThemedText style={styles.replyingTo}>
                ↳ replying to <ThemedText style={[styles.replyingToName, { color: tint }]}>@{node.reply_to_username}</ThemedText>
              </ThemedText>
            </View>
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
      {hasChildren &&
        (expanded ? (
          <View style={[styles.childrenWrap, { borderLeftColor: Colors[colorScheme].icon + '33' }]}>
            {node.children.map((child) => (
              <CommentNode key={child.id} node={child} depth={depth + 1} tunnelUrl={tunnelUrl} onReply={onReply} />
            ))}
          </View>
        ) : (
          <View style={[styles.childrenWrap, { borderLeftColor: Colors[colorScheme].icon + '33' }]}>
            <Pressable onPress={() => setExpanded(true)} style={styles.showMoreButton}>
              <ThemedText style={[styles.showMoreLabel, { color: tint }]}>
                Show {descendantCount} more {descendantCount === 1 ? 'reply' : 'replies'}
              </ThemedText>
            </Pressable>
          </View>
        ))}
    </View>
  );
}

export default function PinDetailScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const hubCenter = useHubCenter();
  const { isSaved, toggleSaved } = useSavedPins();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);

  const [pin, setPin] = useState<AtlasPin | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Shown for ~4s after a fresh save only (not on unsave) — see handleToggleSaved.
  const [pinSavedFeedback, setPinSavedFeedback] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [placePhoto, setPlacePhoto] = useState<PlacePhoto | null>(null);
  const [panoramax, setPanoramax] = useState<PanoramaxImage | null>(null);
  // The linked hub_posts EVENT row for an 'event'-category pin (see
  // AtlasPin.event_post_id) — RSVP here talks to that same post, so it stays
  // in sync with Feed/Events instead of being its own separate concept.
  const [eventPost, setEventPost] = useState<HubPost | null>(null);
  const [replies, setReplies] = useState<AtlasPinReply[]>([]);
  const [replyText, setReplyText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [replyTarget, setReplyTarget] = useState<{ id: string; username: string | null; authorId: string | null } | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    // No single-pin GET route on the server (only list/create/patch/delete) —
    // fetch the list and find it, same shape citinet web itself has to work with.
    listAtlasPins(session.hub.tunnelUrl, session.token)
      .then((pins) => {
        if (cancelled) return;
        const found = pins.find((p) => p.id === id) ?? null;
        if (!found) setError('Pin not found.');
        setPin(found);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load this pin.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, id]);

  useEffect(() => {
    if (!session || !pin?.image_file_name) return;
    let cancelled = false;
    getMediaUrl(session.hub.tunnelUrl, session.token, pin.image_file_name)
      .then((url) => !cancelled && setImageUrl(url))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session, pin?.image_file_name]);

  // Only checked when the pin has no uploaded photo — a real photo the owner
  // chose always wins. Mirrors web's own precedence (user photo > place
  // photo > Panoramax): a Wikidata/Wikipedia-linked landmark photo is a much
  // more specific match than a nearby street-level Panoramax capture, so
  // it's tried first, with Panoramax staying as the fallback for anything
  // this doesn't resolve.
  useEffect(() => {
    if (!pin || pin.image_file_name) return;
    let cancelled = false;
    setPlacePhoto(null);
    fetchPlacePhoto(pin.latitude, pin.longitude, pin.title).then((photo) => {
      if (!cancelled) setPlacePhoto(photo);
    });
    return () => {
      cancelled = true;
    };
  }, [pin]);

  // Panoramax coverage is real but geographically limited (see
  // lib/atlas/panoramax.ts), so the common case is finding nothing — the map
  // fallback below renders immediately either way and silently gets swapped
  // out if/when either this or the place-photo lookup above resolves with a
  // real match, rather than making every pin wait on a network round-trip
  // before showing anything. Runs independently of (and possibly in
  // parallel with) the place-photo lookup — render order below, not fetch
  // order, is what decides priority when both resolve.
  useEffect(() => {
    if (!pin || pin.image_file_name) return;
    let cancelled = false;
    findNearestPanoramaxImage(pin.latitude, pin.longitude).then((match) => {
      if (!cancelled && match) setPanoramax(match);
    });
    return () => {
      cancelled = true;
    };
  }, [pin]);

  useEffect(() => {
    if (!session || !pin?.event_post_id) {
      setEventPost(null);
      return;
    }
    let cancelled = false;
    getPost(session.hub.tunnelUrl, session.token, pin.event_post_id)
      .then((p) => !cancelled && setEventPost(p))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session, pin?.event_post_id]);

  const loadReplies = useCallback(() => {
    if (!session || !pin) return;
    listAtlasPinReplies(session.hub.tunnelUrl, session.token, pin.id)
      .then(setReplies)
      .catch(() => {});
  }, [session, pin]);

  useEffect(loadReplies, [loadReplies]);

  const tree = useMemo(() => buildReplyTree(replies), [replies]);

  function handleDirections() {
    if (!pin) return;
    openDirections(pin.latitude, pin.longitude, pin.title).catch(() => setError("Couldn't open your maps app."));
  }

  function handleToggleSaved() {
    if (!pin) return;
    const wasSaved = isSaved(pin.id);
    toggleSaved(pin.id);
    if (!wasSaved) {
      setPinSavedFeedback(true);
      setTimeout(() => setPinSavedFeedback(false), 4000);
    }
  }

  function handleToggleEventRsvp(post: HubPost) {
    if (!session) return;
    const wasGoing = post.my_rsvp;
    setEventPost({ ...post, my_rsvp: !wasGoing, rsvp_count: post.rsvp_count + (wasGoing ? -1 : 1) });
    toggleRsvp(session.hub.tunnelUrl, session.token, post.id).catch(() => {
      setEventPost((prev) => (prev ? { ...prev, my_rsvp: wasGoing, rsvp_count: prev.rsvp_count } : prev));
    });
  }

  function handleReplyTap(replyId: string, username: string | null, authorId: string | null) {
    setReplyTarget({ id: replyId, username, authorId });
    inputRef.current?.focus();
  }

  async function handleSubmitReply() {
    if (!session || !pin || !replyText.trim()) return;
    setSubmitting(true);
    try {
      await createAtlasPinReply(
        session.hub.tunnelUrl,
        session.token,
        pin.id,
        replyText.trim(),
        replyTarget?.id ?? null,
        replyTarget?.authorId ?? null
      );
      setReplyText('');
      setReplyTarget(null);
      loadReplies();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post comment.');
    } finally {
      setSubmitting(false);
    }
  }

  function confirmDelete() {
    if (!session || !pin) return;
    confirmDestructive('Delete this pin?', 'Delete', () => {
      deleteAtlasPin(session.hub.tunnelUrl, session.token, pin.id)
        .then(() => router.back())
        .catch((err) => setError(err instanceof Error ? err.message : "Couldn't delete this pin."));
    });
  }

  if (!session) return null;

  const meta = pin ? ATLAS_CATEGORIES[pin.category] : null;
  const meters = pin && hubCenter ? distanceMeters(hubCenter[0], hubCenter[1], pin.latitude, pin.longitude) : null;
  const isMine = pin?.author_username === session.username;
  // Mirrors the server's real DELETE rule (author OR admin) — an earlier
  // version of this screen only ever showed the delete control to the
  // author, so a mod using the mobile app had no way to remove a bad pin the
  // server would otherwise let them delete.
  const canDelete = isMine || !!session.isAdmin;
  const saved = pin ? isSaved(pin.id) : false;

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: Colors[colorScheme].background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ThemedView style={styles.flex}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back" accessibilityRole="button">
            <IconSymbol name="chevron.left" size={24} color={Colors[colorScheme].text} />
          </Pressable>
          <ThemedText type="defaultSemiBold" style={styles.title}>
            Pin
          </ThemedText>
          {isMine && pin ? (
            <Pressable onPress={() => router.push(`/atlas/editor?id=${pin.id}` as Href)} hitSlop={12} accessibilityLabel="Edit pin">
              <IconSymbol name="pencil" size={20} color={Colors[colorScheme].text} />
            </Pressable>
          ) : (
            <View style={{ width: 24 }} />
          )}
        </View>

        {loading && <ActivityIndicator style={styles.spinner} />}
        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        {pin && meta && (
          <FlatList
            data={tree}
            keyExtractor={(node) => node.id}
            contentContainerStyle={styles.body}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <CommentNode node={item} depth={0} tunnelUrl={session.hub.tunnelUrl} onReply={handleReplyTap} />
            )}
            ListEmptyComponent={<ThemedText style={styles.rowMeta}>No comments yet. Be the first.</ThemedText>}
            ListHeaderComponent={
              <View>
                <View style={styles.banner}>
                  {pin.image_file_name ? (
                    imageUrl ? (
                      <Image source={{ uri: imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
                    ) : (
                      <View style={[StyleSheet.absoluteFill, styles.bannerFallback, { backgroundColor: meta.color }]}>
                        <ActivityIndicator color="#fff" />
                      </View>
                    )
                  ) : placePhoto ? (
                    <Pressable
                      style={StyleSheet.absoluteFill}
                      disabled={!placePhoto.sourceUrl}
                      onPress={() => placePhoto.sourceUrl && Linking.openURL(placePhoto.sourceUrl)}
                      accessibilityLabel={`Photo credit: ${placePhoto.attribution}`}>
                      <Image source={{ uri: placePhoto.url }} style={StyleSheet.absoluteFill} contentFit="cover" />
                      <View style={styles.panoramaxCredit}>
                        <ThemedText style={styles.panoramaxCreditLabel} lightColor="#fff" darkColor="#fff">
                          {placePhoto.attribution}
                        </ThemedText>
                      </View>
                    </Pressable>
                  ) : panoramax ? (
                    <Pressable
                      style={StyleSheet.absoluteFill}
                      onPress={() =>
                        router.push(
                          `/atlas/panoramax-view?image=${encodeURIComponent(panoramax.imageUrl)}&picture=${panoramax.pictureId}` as Href
                        )
                      }
                      accessibilityLabel="Open interactive street view"
                      accessibilityRole="button">
                      <Image source={{ uri: panoramax.thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
                      <View style={styles.panoramax360Badge}>
                        <IconSymbol name="view.3d" size={12} color="#fff" />
                        <ThemedText style={styles.panoramax360BadgeLabel} lightColor="#fff" darkColor="#fff">
                          Explore street view
                        </ThemedText>
                      </View>
                      {/* etalab-2.0 (the license Panoramax's imagery is published
                          under) expects attribution on reuse. */}
                      <View style={styles.panoramaxCredit}>
                        <ThemedText style={styles.panoramaxCreditLabel} lightColor="#fff" darkColor="#fff">
                          Street view via Panoramax
                        </ThemedText>
                      </View>
                    </Pressable>
                  ) : (
                    <>
                      <LeafletMap pins={[pin]} center={[pin.latitude, pin.longitude]} zoom={17} style={StyleSheet.absoluteFill} />
                      {/* Decorative close-up, not an interactive map — same reasoning
                          as Discover's map card: a WebView inside a ScrollView will
                          fight the outer scroll gesture unless taps/drags are
                          captured here instead of reaching the map underneath. */}
                      <View style={StyleSheet.absoluteFill} />
                    </>
                  )}
                </View>

                <ThemedText type="title" style={styles.pinTitle}>
                  {pin.title}
                </ThemedText>
                <ThemedText style={styles.subMeta}>
                  {meta.label} · Added by {pin.author_username ?? 'someone'}
                  {meters !== null ? ` · ${formatDistanceMiles(meters)}` : ''}
                </ThemedText>

                {pin.description && <ThemedText style={styles.description}>{pin.description}</ThemedText>}

                {eventPost && (
                  <View style={styles.rsvpSection}>
                    {eventPost.event_date && (
                      <View style={styles.eventLine}>
                        <IconSymbol name="calendar" size={14} color={Brand} />
                        <ThemedText style={[styles.eventLineText, { color: Brand }]}>{formatEventWhen(eventPost.event_date)}</ThemedText>
                      </View>
                    )}
                    <EventRsvpButton post={eventPost} onToggle={handleToggleEventRsvp} large />
                    <Pressable onPress={() => router.push({ pathname: '/post/[id]', params: { id: eventPost.id } })} hitSlop={8}>
                      <ThemedText style={[styles.attendeesLink, { color: Brand }]}>View full event & comments</ThemedText>
                    </Pressable>
                  </View>
                )}

                {pin.attachments.length > 0 && (
                  <View style={styles.attachmentsSection}>
                    <ThemedText style={styles.sectionLabel}>Attachments</ThemedText>
                    {pin.attachments.map((att) => {
                      const kind = fileKind(att.file_name, att.mime_type);
                      const kindMeta = FILE_KIND_META[kind];
                      return (
                        <Pressable
                          key={att.file_id}
                          style={styles.attachmentRow}
                          onPress={() => router.push({ pathname: '/files/[id]', params: { id: att.file_id } })}>
                          <View style={[styles.attachmentIcon, { backgroundColor: kindMeta.color }]}>
                            <IconSymbol name={kindMeta.icon} size={16} color="#fff" />
                          </View>
                          <View style={styles.attachmentText}>
                            <ThemedText numberOfLines={1} style={styles.attachmentName}>
                              {att.file_name}
                            </ThemedText>
                            <ThemedText style={styles.rowMeta}>{formatBytes(att.size)}</ThemedText>
                          </View>
                          <IconSymbol name="chevron.right" size={14} color={Colors[colorScheme].icon} />
                        </Pressable>
                      );
                    })}
                  </View>
                )}

                <View style={styles.actions}>
                  <Pressable onPress={handleToggleSaved} style={[styles.actionButton, saved && { backgroundColor: Brand }]}>
                    <IconSymbol name={saved ? 'bookmark.circle.fill' : 'bookmark'} size={17} color={saved ? '#fff' : Colors[colorScheme].text} />
                    <ThemedText style={styles.actionLabel} lightColor={saved ? '#fff' : undefined} darkColor={saved ? '#fff' : undefined}>
                      {saved ? 'Saved' : 'Save'}
                    </ThemedText>
                  </Pressable>
                  <Pressable style={styles.actionButton} onPress={() => router.push(`/atlas/share?id=${pin.id}` as Href)}>
                    <IconSymbol name="square.and.arrow.up" size={17} color={Colors[colorScheme].text} />
                    <ThemedText style={styles.actionLabel}>Share</ThemedText>
                  </Pressable>
                  <Pressable style={styles.actionButton} onPress={handleDirections}>
                    <IconSymbol name="arrow.triangle.turn.up.right.diamond.fill" size={17} color={Colors[colorScheme].text} />
                    <ThemedText style={styles.actionLabel}>Directions</ThemedText>
                  </Pressable>
                </View>

                {pinSavedFeedback && (
                  <ThemedText style={styles.savedFeedback}>
                    Saved — find it under Profile → Saved pins, or the bookmark filter in Atlas.
                  </ThemedText>
                )}

                {canDelete && (
                  <Pressable onPress={confirmDelete} style={styles.deleteRow}>
                    <IconSymbol name="trash.fill" size={16} color="#b0392f" />
                    <ThemedText style={styles.deleteLabel}>Delete pin</ThemedText>
                  </Pressable>
                )}

                <ThemedText style={styles.commentsHeading}>Comments</ThemedText>
              </View>
            }
          />
        )}

        {pin && (
          <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 8 : 16) }]}>
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
                <ThemedText style={{ color: Colors[colorScheme].tint, fontWeight: '600' }}>Send</ThemedText>
              </Pressable>
            </View>
          </View>
        )}
      </ThemedView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
  },
  title: {
    fontSize: 17,
  },
  spinner: {
    marginTop: 40,
  },
  error: {
    color: '#b0392f',
    paddingHorizontal: 20,
    marginTop: 12,
  },
  body: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  banner: {
    height: 120,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  bannerFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  panoramaxCredit: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  panoramaxCreditLabel: {
    fontSize: 10.5,
    fontWeight: '600',
  },
  panoramax360Badge: {
    position: 'absolute',
    right: 8,
    top: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  panoramax360BadgeLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  pinTitle: {
    fontSize: 22,
    marginBottom: 4,
  },
  subMeta: {
    opacity: 0.6,
    fontSize: 13.5,
    marginBottom: 16,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
  },
  eventLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  eventLineText: {
    fontSize: 13.5,
    fontWeight: '600',
  },
  rsvpSection: {
    gap: 10,
    marginBottom: 20,
  },
  attendeesLink: {
    fontSize: 13,
    fontWeight: '600',
  },
  attachmentsSection: {
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  attachmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  attachmentIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentText: {
    flex: 1,
    gap: 1,
  },
  attachmentName: {
    fontSize: 14,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#8881',
  },
  actionLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  savedFeedback: {
    fontSize: 12.5,
    color: Brand,
    lineHeight: 17,
    marginTop: -10,
    marginBottom: 20,
  },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  deleteLabel: {
    color: '#b0392f',
    fontSize: 14.5,
  },
  commentsHeading: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginTop: 4,
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
  commentAuthor: {
    fontSize: 14,
  },
  replyingToPill: {
    alignSelf: 'flex-start',
    marginTop: 1,
  },
  replyingTo: {
    fontSize: 12,
    opacity: 0.6,
  },
  replyingToName: {
    fontWeight: '600',
    opacity: 1,
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
  // The border-left is the thread connector line — offset to roughly align
  // with the avatar column above it, so a reply visibly hangs off its parent
  // rather than just sitting indented with nothing tying it back.
  childrenWrap: {
    marginLeft: 13,
    paddingLeft: 15,
    borderLeftWidth: 2,
    marginBottom: 4,
  },
  showMoreButton: {
    paddingVertical: 8,
  },
  showMoreLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#8884',
    paddingHorizontal: 20,
    paddingTop: 8,
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
