import { Pressable, StyleSheet, View } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { HubPost } from '@/lib/api/types';
import { timeLeft } from '@/lib/ui/time-ago';

type Props = {
  post: HubPost;
  onVote: (post: HubPost, optionIndex: number) => void;
};

const WINNER_TINT = '#1f9e5c';

// Renders the vote options for a POLL-category post — used inline by
// PostRow and the post-detail screen, right after the title/body they
// already render (a poll is a post with this attached, not a separate
// screen or content type — see [[citinet-mobile-design-rules]]).
export function PollCard({ post, onVote }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const poll = post.poll;
  if (!poll) return null;

  const isClosed = poll.closed || (poll.closes_at ? new Date(poll.closes_at).getTime() < Date.now() : false);
  const hasVoted = poll.my_vote != null;
  const showResults = hasVoted || isClosed;
  const remaining = !isClosed && poll.closes_at ? timeLeft(poll.closes_at) : null;
  const maxCount = Math.max(0, ...poll.vote_counts);
  const quorumNeeded = poll.quorum_pct > 0 ? Math.ceil((poll.member_count * poll.quorum_pct) / 100) : 0;
  const quorumMet = poll.quorum_pct === 0 || poll.total_votes >= quorumNeeded;

  let statusLabel: string | null = null;
  let statusIcon: 'checkmark.circle.fill' | 'xmark' | 'circle' | null = null;
  let statusColor = Colors[colorScheme].icon;
  if (isClosed) {
    if (poll.passed === true) {
      statusLabel = 'Passed';
      statusIcon = 'checkmark.circle.fill';
      statusColor = WINNER_TINT;
    } else if (poll.passed === false) {
      statusLabel = 'Failed';
      statusIcon = 'xmark';
      statusColor = '#d1465f';
    } else {
      statusLabel = 'Closed';
    }
  } else if (remaining) {
    statusLabel = remaining;
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.options}>
        {poll.options.map((label, i) => {
          const count = poll.vote_counts[i] ?? 0;
          const pct = poll.total_votes > 0 ? Math.round((count / poll.total_votes) * 100) : 0;
          const isMine = poll.my_vote === i;
          const isWinner = isClosed && count === maxCount && count > 0;
          const barColor = isWinner ? WINNER_TINT : isMine ? Brand : Colors[colorScheme].icon;

          return (
            <Pressable
              key={i}
              disabled={isClosed}
              onPress={(e) => {
                e.stopPropagation();
                onVote(post, i);
              }}
              style={[
                styles.option,
                { borderColor: isMine ? Brand : 'transparent', backgroundColor: showResults ? 'transparent' : '#8881' },
              ]}>
              {showResults && (
                <View style={[styles.optionFill, { width: `${pct}%`, backgroundColor: barColor, opacity: 0.16 }]} />
              )}
              <ThemedText style={[styles.optionLabel, isMine && { color: Brand, fontWeight: '600' }]} numberOfLines={2}>
                {label}
              </ThemedText>
              <View style={styles.optionMeta}>
                {showResults && <ThemedText style={styles.optionPct}>{pct}%</ThemedText>}
                {isMine && <IconSymbol name="checkmark.circle.fill" size={15} color={Brand} />}
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.footer}>
        <ThemedText style={styles.footerMeta}>
          {poll.total_votes} vote{poll.total_votes === 1 ? '' : 's'}
        </ThemedText>
        {statusLabel && (
          <View style={styles.statusPill}>
            {statusIcon && <IconSymbol name={statusIcon} size={11} color={statusColor} />}
            <ThemedText style={[styles.statusLabel, { color: statusColor }]}>{statusLabel}</ThemedText>
          </View>
        )}
      </View>

      {poll.quorum_pct > 0 && (
        <View style={styles.quorumWrap}>
          <View style={styles.quorumTrack}>
            <View
              style={[
                styles.quorumFill,
                {
                  width: `${Math.min(100, (poll.total_votes / Math.max(1, quorumNeeded)) * 100)}%`,
                  backgroundColor: quorumMet ? WINNER_TINT : Brand,
                },
              ]}
            />
          </View>
          <ThemedText style={styles.quorumLabel}>
            {quorumMet ? 'Quorum met' : `Quorum: ${quorumNeeded} votes needed`}
          </ThemedText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
    marginTop: 2,
  },
  options: {
    gap: 6,
  },
  option: {
    borderRadius: 10,
    borderWidth: 1.5,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    overflow: 'hidden',
  },
  optionFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  optionLabel: {
    flex: 1,
    fontSize: 14.5,
  },
  optionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  optionPct: {
    fontSize: 12.5,
    fontWeight: '600',
    opacity: 0.7,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footerMeta: {
    fontSize: 12.5,
    opacity: 0.6,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  quorumWrap: {
    gap: 4,
  },
  quorumTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#8882',
    overflow: 'hidden',
  },
  quorumFill: {
    height: '100%',
    borderRadius: 2,
  },
  quorumLabel: {
    fontSize: 11,
    opacity: 0.55,
  },
});
