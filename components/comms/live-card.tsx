import { Pressable, StyleSheet, View } from 'react-native';

import { BrandGradient } from '@/components/brand-gradient';
import { LiveThumbnail } from '@/components/comms/live-thumbnail';
import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/theme';
import { LiveCommsItem } from '@/lib/api/types';

// Shared between app/(tabs)/messages.tsx's own "Live now" strip (hub-wide)
// and app/spaces/[slug].tsx's (space-scoped, via listLiveComms's own
// spaceSlug param) — same card either way, just fed a different list.
//
// No preview thumbnail exists for a room's stream (would mean subscribing
// to every live card's video just to render a list, expensive for what's
// meant to be a lightweight strip) — a brand/red gradient placeholder fills
// the same visual role honestly, same simplification this app already uses
// for avatars with no uploaded photo. Only broadcast cards are tappable —
// joins as a viewer (see BroadcastProvider's joinAsViewer). Rooms (kind
// 'room', the OPEN badge) don't have a destination screen yet.
export function LiveCard({ item, onPress, showPreview }: { item: LiveCommsItem; onPress?: () => void; showPreview?: boolean }) {
  const isLive = item.kind === 'broadcast';
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={styles.liveCard}>
      <BrandGradient style={StyleSheet.absoluteFillObject} />
      {/* Lets a viewer see what they're about to walk into. Skipped for
          "isMine" cards (see each caller's own visibleLive filter) —
          connecting a second, hidden identity to a room you're already
          really in as yourself would collide with your real session's
          LiveKit identity. */}
      {showPreview && <LiveThumbnail roomName={item.room_name} hostId={item.host_id} />}
      <View style={[styles.liveBadge, { backgroundColor: isLive ? '#DC2B2B' : Brand }]}>
        <ThemedText style={styles.liveBadgeLabel} lightColor="#fff" darkColor="#fff">
          {isLive ? 'LIVE' : 'OPEN'}
        </ThemedText>
      </View>
      <View style={styles.liveCountPill}>
        <ThemedText style={styles.liveCountText} lightColor="#fff" darkColor="#fff">
          {item.participant_count} {isLive ? 'watching' : 'here'}
        </ThemedText>
      </View>
      <View style={styles.liveCardFooter}>
        <View style={styles.liveHostRow}>
          <View style={styles.liveHostMonogram}>
            <ThemedText style={styles.liveHostInitial} lightColor="#fff" darkColor="#fff">
              {(item.host_username || '?').charAt(0).toUpperCase()}
            </ThemedText>
          </View>
          <ThemedText style={styles.liveHostName} lightColor="#fff" darkColor="#fff" numberOfLines={1}>
            {item.host_username} · {isLive ? 'Broadcast' : 'Room'}
          </ThemedText>
        </View>
        <ThemedText style={styles.liveTitle} lightColor="#fff" darkColor="#fff" numberOfLines={2}>
          {item.title || (isLive ? 'Live broadcast' : 'Open room')}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  liveCard: {
    width: 148,
    height: 196,
    borderRadius: 16,
    overflow: 'hidden',
  },
  liveBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  liveBadgeLabel: {
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  liveCountPill: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  liveCountText: {
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
  liveCardFooter: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    gap: 4,
  },
  liveHostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liveHostMonogram: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveHostInitial: {
    fontSize: 10,
    fontWeight: '700',
  },
  liveHostName: {
    fontSize: 11,
    flex: 1,
    opacity: 0.9,
  },
  liveTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
});
