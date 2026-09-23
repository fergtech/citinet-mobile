import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useBroadcast } from '@/lib/comms/broadcast-context';
import { formatCallDuration, useElapsedSeconds } from '@/lib/comms/use-elapsed';

// Shared between app/(tabs)/messages.tsx and app/clubs/[slug].tsx — a
// minimized broadcast (this device's own, host or viewer) can be restored
// from either screen, not just wherever it happened to be minimized from.
// Own component, not inlined into either caller, so the elapsed-seconds
// tick only re-renders this small bar, not the whole screen around it.
export function MinimizedBroadcastBar({ onPress }: { onPress: () => void }) {
  const { broadcast } = useBroadcast();
  const elapsed = useElapsedSeconds(broadcast.startedAt);
  // The join-request card only exists inside the live screen itself
  // (components/comms/broadcast-overlay.tsx) — a minimized host would
  // otherwise never know one arrived at all. This is the only surface that
  // exists while minimized, so it has to carry that signal.
  const hasPendingRequest = broadcast.role === 'host' && !!broadcast.pendingRequest;
  return (
    <Pressable onPress={onPress} style={[styles.minimizeBar, hasPendingRequest && styles.minimizeBarAlert]}>
      <View style={[styles.minimizeDot, hasPendingRequest && styles.minimizeDotAlert]} />
      <ThemedText style={styles.minimizeLabel} lightColor="#fff" darkColor="#fff" numberOfLines={1}>
        {hasPendingRequest ? `${broadcast.pendingRequest!.requesterName} wants to join in` : broadcast.role === 'host' ? 'Broadcasting live' : 'Watching live'}
      </ThemedText>
      <ThemedText style={styles.minimizeTimer} lightColor="#fff" darkColor="#fff">
        {formatCallDuration(elapsed)}
      </ThemedText>
      <IconSymbol name="chevron.up" size={14} color="#fff" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  minimizeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#4A1616',
    marginHorizontal: 20,
    marginBottom: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  minimizeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#DC2B2B',
  },
  minimizeBarAlert: {
    backgroundColor: '#331CA7',
  },
  minimizeDotAlert: {
    backgroundColor: '#fff',
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
