import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { Brand, Colors } from '@/constants/theme';
import { listAtlasPins } from '@/lib/api/hubService';
import { AtlasPin } from '@/lib/api/types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSession } from '@/lib/session/session-context';

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

type Props = {
  location: string;
  // The event post this location came from — passed through to
  // app/atlas/location.tsx (only reached when there's no matching pin) so
  // that screen can show a real title and a way back to the event, rather
  // than a bare, unlabeled coordinate.
  eventTitle?: string | null;
  eventId?: string;
};

export function EventAtlasLink({ location, eventTitle, eventId }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const [pin, setPin] = useState<AtlasPin | null>(null);

  useEffect(() => {
    if (!session || !location.trim()) return;
    let cancelled = false;
    listAtlasPins(session.hub.tunnelUrl, session.token)
      .then((pins) => {
        if (cancelled) return;
        const locationKey = normalize(location);
        setPin(pins.find((candidate) => normalize(candidate.title) === locationKey) ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [location, session]);

  function openAtlas() {
    if (pin) {
      router.push({ pathname: '/atlas/[id]', params: { id: pin.id } });
    } else {
      // No real pin at this location (yet) — a plain Atlas map with a
      // dropped marker and a dead-end "no pins match your search" list
      // isn't useful here. Land on a purpose-built preview instead: real
      // Directions/Share (only ever needed coordinates) plus a bridge into
      // actually creating a pin, pre-filled — see app/atlas/location.tsx.
      router.push({
        pathname: '/atlas/location',
        params: { query: location.trim(), title: eventTitle ?? undefined, eventId },
      });
    }
  }

  return (
    <Pressable
      style={[styles.row, { borderColor: Colors[colorScheme].icon + '33' }]}
      onPress={openAtlas}
      accessibilityRole="button"
      accessibilityLabel={`Open ${location} in Atlas`}>
      <View style={styles.iconWrap}>
        <IconSymbol name="mappin.and.ellipse" size={18} color={Brand} />
      </View>
      <View style={styles.content}>
        <ThemedText type="defaultSemiBold" numberOfLines={1}>
          {location}
        </ThemedText>
      </View>
      <IconSymbol name="chevron.right" size={16} color={Colors[colorScheme].icon} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 10,
    marginTop: 2,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2164f322',
  },
  content: {
    flex: 1,
  },
});
