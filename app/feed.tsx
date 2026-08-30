import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { PostRow } from '@/components/post-row';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { getPosts, toggleLike, toggleRsvp, votePoll } from '@/lib/api/hubService';
import { HubPost } from '@/lib/api/types';
import { applyVote } from '@/lib/ui/poll';
import { useSession } from '@/lib/session/session-context';

export default function FeedScreen() {
  const { session } = useSession();
  const [posts, setPosts] = useState<HubPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!session) return;
    setLoading(true);
    setError(null);
    getPosts(session.hub.tunnelUrl, session.token)
      .then(setPosts)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load.'))
      .finally(() => setLoading(false));
  }, [session]);

  // Focus-based, not mount-only — see Home/Messages for why (liking or voting
  // from a post's own detail screen and coming back here should show it).
  useFocusEffect(load);

  function handleToggleLike(post: HubPost) {
    if (!session) return;
    const wasLiked = post.my_liked;
    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id ? { ...p, my_liked: !wasLiked, like_count: p.like_count + (wasLiked ? -1 : 1) } : p
      )
    );
    toggleLike(session.hub.tunnelUrl, session.token, post.id).catch(() => {
      setPosts((prev) =>
        prev.map((p) => (p.id === post.id ? { ...p, my_liked: wasLiked, like_count: post.like_count } : p))
      );
    });
  }

  function handleVotePoll(post: HubPost, optionIndex: number) {
    if (!session) return;
    const prevPoll = post.poll;
    setPosts((prev) => prev.map((p) => (p.id === post.id ? applyVote(p, optionIndex) : p)));
    votePoll(session.hub.tunnelUrl, session.token, post.id, optionIndex).catch(() => {
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, poll: prevPoll } : p)));
    });
  }

  function handleToggleRsvp(post: HubPost) {
    if (!session) return;
    const wasGoing = post.my_rsvp;
    setPosts((prev) =>
      prev.map((p) => (p.id === post.id ? { ...p, my_rsvp: !wasGoing, rsvp_count: p.rsvp_count + (wasGoing ? -1 : 1) } : p))
    );
    toggleRsvp(session.hub.tunnelUrl, session.token, post.id).catch(() => {
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, my_rsvp: wasGoing, rsvp_count: post.rsvp_count } : p)));
    });
  }

  if (!session) return null;

  return (
    <ThemedView style={styles.flex}>
      <ScreenHeader title="Feed" />
      {loading && posts.length === 0 && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}
      <FlatList
        data={posts}
        keyExtractor={(post) => post.id}
        contentContainerStyle={styles.list}
        onRefresh={load}
        refreshing={loading}
        renderItem={({ item }) => (
          <PostRow
            post={item}
            tunnelUrl={session.hub.tunnelUrl}
            token={session.token}
            onToggleLike={handleToggleLike}
            onVotePoll={handleVotePoll}
            onToggleRsvp={handleToggleRsvp}
          />
        )}
        ListEmptyComponent={!loading ? <ThemedText style={styles.empty}>No posts yet.</ThemedText> : null}
      />
    </ThemedView>
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
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  empty: {
    opacity: 0.6,
    fontSize: 13,
  },
});
