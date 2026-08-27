import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { EventAtlasLink } from '@/components/event-atlas-link';
import { EventRsvpButton } from '@/components/event-rsvp-button';
import { HubAvatar } from '@/components/hub-avatar';
import { HubMedia } from '@/components/hub-media';
import { PollCard } from '@/components/poll-card';
import { ThemedText } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { HubPost } from '@/lib/api/types';
import { useSession } from '@/lib/session/session-context';
import { formatEventWhen } from '@/lib/ui/format-event';
import { goToProfile } from '@/lib/ui/navigate-to-profile';
import { timeAgo } from '@/lib/ui/time-ago';

// Some posts carry a title that's just a duplicate of the body (or the body is
// empty and the title is the only content) — only show the title when it adds
// something the body doesn't already say, verbatim.
function hasDistinctTitle(post: HubPost): boolean {
  return !!post.title?.trim() && post.title.trim() !== post.body.trim();
}

type Props = {
  post: HubPost;
  tunnelUrl: string;
  token: string;
  onToggleLike: (post: HubPost) => void;
  onVotePoll: (post: HubPost, optionIndex: number) => void;
  onToggleRsvp: (post: HubPost) => void;
  // Experiment (Home's Events section, for now): drops the avatar+name
  // header entirely and moves attribution to a small "@username · time"
  // byline near the bottom, above the RSVP/like/comment row — mirrors how
  // FeaturedCarousel already attributes its cards. Opt-in so every other
  // PostRow usage (Discussions, Feed, the standalone Events screen) keeps
  // the current header treatment until/unless this lands well enough to
  // extend further.
  compactAuthor?: boolean;
};

export function PostRow({ post, tunnelUrl, token, onToggleLike, onVotePoll, onToggleRsvp, compactAuthor }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();

  function handleAuthorPress(e: { stopPropagation: () => void }) {
    e.stopPropagation();
    if (session) goToProfile(post.author_id, session.userId);
  }

  return (
    <Pressable style={styles.row} onPress={() => router.push({ pathname: '/post/[id]', params: { id: post.id } })}>
      {!compactAuthor && (
        <Pressable style={styles.header} onPress={handleAuthorPress}>
          <HubAvatar userId={post.author_id} displayName={post.author_username ?? '?'} tunnelUrl={tunnelUrl} size={36} />
          <View style={styles.headerText}>
            <ThemedText type="defaultSemiBold">{post.author_username ?? 'Citinet'}</ThemedText>
            
          </View>
        </Pressable>
      )}
      {post.category === 'EVENT' && post.event_date && (
        <View style={styles.eventLine}>
          <IconSymbol name="calendar" size={13} color={Brand} />
          <ThemedText style={[styles.eventLineText, { color: Brand }]} numberOfLines={1}>
            {formatEventWhen(post.event_date)}
          </ThemedText>
        </View>
      )}
      {hasDistinctTitle(post) && (
        <ThemedText type="defaultSemiBold" style={styles.title}>
          {post.title}
        </ThemedText>
      )}
      {!!post.body.trim() && (
        <ThemedText style={styles.body} numberOfLines={6}>
          {post.body}
        </ThemedText>
      )}
      {post.media_file_name && (
        <View style={styles.mediaWrap}>
          <HubMedia fileName={post.media_file_name} tunnelUrl={tunnelUrl} token={token} previewSeconds={4} />
        </View>
      )}
      {post.category === 'POLL' && post.poll && <PollCard post={post} onVote={onVotePoll} />}
      {post.category === 'EVENT' && post.event_location && (
        <EventAtlasLink location={post.event_location} eventTitle={post.title} eventId={post.id} />
      )}
      {compactAuthor && (
        <Pressable onPress={handleAuthorPress} hitSlop={6} style={styles.compactAuthorWrap}>
          <ThemedText style={styles.compactAuthor}>
            @{post.author_username ?? 'citinet'} · {timeAgo(post.created_at)}
          </ThemedText>
        </Pressable>
      )}
      {post.category === 'EVENT' && <EventRsvpButton post={post} onToggle={onToggleRsvp} />}
      <ThemedText style={styles.meta}>
        {/*{post.category.charAt(0) + post.category.slice(1).toLowerCase()} · */}{timeAgo(post.created_at)}
      </ThemedText>
      <View style={styles.footer}>
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            onToggleLike(post);
          }}
          style={styles.likeButton}
          hitSlop={8}>
          <IconSymbol
            name={post.my_liked ? 'heart.fill' : 'heart'}
            size={18}
            color={post.my_liked ? '#d1465f' : Colors[colorScheme].icon}
          />
          <ThemedText style={styles.meta}>{post.like_count}</ThemedText>
        </Pressable>
        <ThemedText style={styles.meta}>💬 {post.reply_count}</ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
    paddingVertical: 16,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  meta: {
    opacity: 0.6,
    fontSize: 13,
  },
  eventLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  eventLineText: {
    fontSize: 13,
    fontWeight: '600',
  },
  title: {
    fontSize: 15,
  },
  body: {
    fontSize: 15,
    lineHeight: 21,
  },
  mediaWrap: {
    marginTop: 4,
  },
  compactAuthorWrap: {
    alignSelf: 'flex-start',
  },
  compactAuthor: {
    fontSize: 12.5,
    opacity: 0.6,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    marginTop: 4,
  },
  likeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
