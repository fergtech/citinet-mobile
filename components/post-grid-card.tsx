import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { router } from 'expo-router';

import { HubAvatar } from '@/components/hub-avatar';
import { HubMedia } from '@/components/hub-media';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { HubPost } from '@/lib/api/types';
import { useSession } from '@/lib/session/session-context';
import { goToProfile } from '@/lib/ui/navigate-to-profile';
import { timeAgo } from '@/lib/ui/time-ago';

// Title takes priority over body, never both — one short line of context per
// tile instead of a title-plus-caption stack. No text at all if the post has
// neither (media speaks for itself then).
function pickText(post: HubPost): string | null {
  const title = post.title?.trim();
  if (title) return title;
  const body = post.body.trim();
  return body || null;
}

function metaLine(post: HubPost): string {
  const category = post.category.charAt(0) + post.category.slice(1).toLowerCase();
  const votes = post.category === 'POLL' && post.poll ? ` · ${post.poll.total_votes} votes` : '';
  return `${category}${votes} · ${timeAgo(post.created_at)}`;
}

type Props = {
  post: HubPost;
  tunnelUrl: string;
  token: string;
  onToggleLike: (post: HubPost) => void;
  style?: StyleProp<ViewStyle>;
};

// A compact, equally-proportioned tile for Home's Discussions grid (the full
// listing at app/feed.tsx stays the vertical PostRow). When a post has media,
// the media fills the whole square tile and text overlays it, scrim-backed,
// at the bottom — media is the visual, text is a minimal caption on top of
// it, not a separate block competing with it. No inline poll voting here (see
// components/poll-card.tsx) — a poll's options don't fit a uniform tile, so a
// POLL post just shows its vote count in the meta line and taps through.
export function PostGridCard({ post, tunnelUrl, token, onToggleLike, style }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const hasMedia = !!post.media_file_name;
  const text = pickText(post);

  function handleLike(e: { stopPropagation: () => void }) {
    e.stopPropagation();
    onToggleLike(post);
  }

  function handleAuthorPress(e: { stopPropagation: () => void }) {
    e.stopPropagation();
    if (session) goToProfile(post.author_id, session.userId);
  }

  return (
    <Pressable style={[styles.card, style]} onPress={() => router.push({ pathname: '/post/[id]', params: { id: post.id } })}>
      {hasMedia ? (
        <>
          <HubMedia
            fileName={post.media_file_name!}
            tunnelUrl={tunnelUrl}
            token={token}
            style={styles.fullBleedMedia}
            previewSeconds={4}
          />
          <Pressable onPress={handleAuthorPress} style={styles.avatarBadge} hitSlop={6}>
            <HubAvatar userId={post.author_id} displayName={post.author_username ?? '?'} tunnelUrl={tunnelUrl} size={22} />
          </Pressable>
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.92)']}
            locations={[0, 0.5, 1]}
            style={styles.scrim}>
            {text && (
              <ThemedText style={styles.overlayText} numberOfLines={2} lightColor="#fff" darkColor="#fff">
                {text}
              </ThemedText>
            )}
            <View style={styles.overlayFooter}>
              <ThemedText style={styles.overlayMeta} numberOfLines={1}>
                {metaLine(post)}
              </ThemedText>
              <View style={styles.engagement}>
                <Pressable onPress={handleLike} style={styles.likeButton} hitSlop={8}>
                  <IconSymbol
                    name={post.my_liked ? 'heart.fill' : 'heart'}
                    size={13}
                    color={post.my_liked ? '#ff6b81' : '#fff'}
                  />
                  <ThemedText style={styles.overlayMeta}>{post.like_count}</ThemedText>
                </Pressable>
                <ThemedText style={styles.overlayMeta}>💬 {post.reply_count}</ThemedText>
              </View>
            </View>
          </LinearGradient>
        </>
      ) : (
        <View style={styles.textOnly}>
          <Pressable onPress={handleAuthorPress} style={styles.header}>
            <HubAvatar userId={post.author_id} displayName={post.author_username ?? '?'} tunnelUrl={tunnelUrl} size={20} />
            <ThemedText style={styles.author} numberOfLines={1}>
              {post.author_username ?? 'Citinet'}
            </ThemedText>
          </Pressable>
          {text && (
            <ThemedText style={styles.plainText} numberOfLines={5}>
              {text}
            </ThemedText>
          )}
          <View style={styles.plainFooter}>
            <ThemedText style={styles.meta} numberOfLines={1}>
              {metaLine(post)}
            </ThemedText>
            <View style={styles.engagement}>
              <Pressable onPress={handleLike} style={styles.likeButton} hitSlop={8}>
                <IconSymbol
                  name={post.my_liked ? 'heart.fill' : 'heart'}
                  size={13}
                  color={post.my_liked ? '#d1465f' : Colors[colorScheme].icon}
                />
                <ThemedText style={styles.meta}>{post.like_count}</ThemedText>
              </Pressable>
              <ThemedText style={styles.meta}>💬 {post.reply_count}</ThemedText>
            </View>
          </View>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '48%',
    aspectRatio: 1,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#8881',
  },
  fullBleedMedia: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 0,
    width: undefined,
    height: undefined,
    aspectRatio: undefined,
    borderRadius: 0,
  },
  avatarBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    zIndex: 2,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  // Spans about three-quarters of the card rather than hugging just the
  // text — gives the gradient real room to fade in gradually instead of the
  // dimming starting right at a hard box edge a couple lines above the caption.
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: '25%',
    zIndex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 10,
    paddingBottom: 8,
    gap: 4,
  },
  overlayText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  overlayFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  overlayMeta: {
    color: '#fff',
    fontSize: 11.5,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  textOnly: {
    flex: 1,
    padding: 10,
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  author: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '600',
  },
  plainText: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
  },
  plainFooter: {
    gap: 4,
  },
  meta: {
    opacity: 0.6,
    fontSize: 11,
  },
  engagement: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  likeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
});
