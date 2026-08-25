import { Pressable, StyleSheet, View } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { HubPost } from '@/lib/api/types';
import { isPastEvent } from '@/lib/ui/format-event';

// Shared by components/post-row.tsx (list contexts — Home's featured event,
// Feed, Events) and app/post/[id].tsx (detail) — one toggle control, sized
// via `large`. Mirrors the like button's optimistic-toggle contract exactly
// (post.my_rsvp/post.rsvp_count in, onToggle(post) out), same as
// onToggleLike — the caller owns the actual API call + rollback-on-failure.
export function EventRsvpButton({
  post,
  onToggle,
  large,
}: {
  post: HubPost;
  onToggle: (post: HubPost) => void;
  large?: boolean;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const going = post.my_rsvp;

  // Toggling "going" on something that already happened doesn't mean
  // anything — this becomes a plain read-only attendance count instead of
  // an actionable button once the event's date has passed (app/events.tsx's
  // "Past" tab is the main place this shows up).
  if (post.event_date && isPastEvent(post.event_date)) {
    return (
      <View style={[styles.button, styles.buttonPast, large && styles.buttonLarge]}>
        <IconSymbol name="checkmark.circle" size={large ? 17 : 14} color={Colors[colorScheme].icon} />
        <ThemedText style={[styles.label, styles.labelPast, large && styles.labelLarge]}>
          {post.rsvp_count} {post.rsvp_count === 1 ? 'person' : 'people'} went
        </ThemedText>
      </View>
    );
  }

  return (
    <Pressable
      onPress={(e) => {
        e.stopPropagation();
        onToggle(post);
      }}
      style={[styles.button, large && styles.buttonLarge, going && { backgroundColor: Brand }]}>
      <IconSymbol
        name={going ? 'checkmark.circle.fill' : 'calendar'}
        size={large ? 17 : 14}
        color={going ? '#fff' : Colors[colorScheme].text}
        style={!going && styles.iconNeutral}
      />
      <ThemedText style={[styles.label, large && styles.labelLarge]} lightColor={going ? '#fff' : undefined} darkColor={going ? '#fff' : undefined}>
        {going ? "You're going" : "I'm going"}
      </ThemedText>
      <ThemedText
        style={[styles.count, large && styles.countLarge]}
        lightColor={going ? 'rgba(255,255,255,0.85)' : undefined}
        darkColor={going ? 'rgba(255,255,255,0.85)' : undefined}>
        · {post.rsvp_count} going
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#8881',
  },
  buttonLarge: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  buttonPast: {
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
  },
  labelPast: {
    opacity: 0.6,
  },
  iconNeutral: {
    opacity: 0.7,
  },
  label: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  labelLarge: {
    fontSize: 14,
  },
  count: {
    fontSize: 12.5,
    opacity: 0.6,
  },
  countLarge: {
    fontSize: 13.5,
  },
});
