import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { AtlasPin } from '@/lib/api/types';
import { ATLAS_CATEGORIES } from '@/lib/atlas/categories';
import { formatDistanceMiles } from '@/lib/atlas/geocoding';

// Shared by Home's "From the Atlas" strip and Discover's Atlas section —
// one card design for "here's a specific pin," not a near-duplicate per
// screen. Sizing (strip width vs. grid `48%`) is the caller's job via `style`.
export function AtlasPinCard({
  pin,
  meters,
  onPress,
  style,
}: {
  pin: AtlasPin;
  meters: number | null;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const meta = ATLAS_CATEGORIES[pin.category];
  return (
    <Pressable style={[styles.card, style]} onPress={onPress}>
      <View style={[styles.icon, { backgroundColor: meta.color }]}>
        <IconSymbol name={meta.icon} size={18} color="#fff" />
      </View>
      <ThemedText type="defaultSemiBold" numberOfLines={1} style={styles.title}>
        {pin.title}
      </ThemedText>
      <ThemedText numberOfLines={1} style={styles.meta}>
        {meta.label}
        {meters !== null ? ` · ${formatDistanceMiles(meters)}` : ''}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#8881',
    gap: 6,
  },
  icon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 13.5,
  },
  meta: {
    opacity: 0.6,
    fontSize: 13,
  },
});
