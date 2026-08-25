import { HubPost, HubPostPoll } from '@/lib/api/types';

// Same optimistic-update shape as toggleLike's callers (compute the new
// state, apply it locally, fire the request, roll back on failure) — shared
// here since every PostRow/post-detail screen needs identical vote math.
// Voting a second time changes the vote rather than being a no-op (matches
// citinet web: "Cast (or change) a vote").
export function applyVote(post: HubPost, optionIndex: number): HubPost {
  const poll = post.poll;
  if (!poll) return post;
  const prevVote = poll.my_vote;
  if (prevVote === optionIndex) return post;

  const voteCounts = [...poll.vote_counts];
  if (prevVote != null) voteCounts[prevVote] = Math.max(0, voteCounts[prevVote] - 1);
  voteCounts[optionIndex] = (voteCounts[optionIndex] ?? 0) + 1;

  const nextPoll: HubPostPoll = {
    ...poll,
    vote_counts: voteCounts,
    total_votes: prevVote == null ? poll.total_votes + 1 : poll.total_votes,
    my_vote: optionIndex,
  };
  return { ...post, poll: nextPoll };
}
