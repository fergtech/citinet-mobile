import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import { AuthBackground } from '@/components/auth-background';
import { BrandGradient } from '@/components/brand-gradient';
import { HubIcon, HubLetterFallback } from '@/components/hub-icon';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getHubs } from '@/lib/api/registryService';
import { RegistryHub } from '@/lib/api/types';

export default function HubSelectScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const tint = Colors[colorScheme].tint;

  const [hubs, setHubs] = useState<RegistryHub[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    getHubs()
      .then(setHubs)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = hubs.filter((hub) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return hub.name.toLowerCase().includes(needle) || hub.location?.toLowerCase().includes(needle);
  });

  const selectedHub = hubs.find((hub) => hub.id === selectedId) ?? null;

  function handleContinue() {
    if (!selectedHub) return;
    router.push({
      pathname: '/(auth)/login',
      params: {
        hubId: selectedHub.id,
        hubSlug: selectedHub.slug,
        hubName: selectedHub.name,
        tunnelUrl: selectedHub.tunnel_url,
        location: selectedHub.location ?? '',
        // Carried along so login.tsx can render the same custom hub icon
        // without a second registry round-trip — see components/hub-icon.tsx.
        hubIconMode: selectedHub.hub_icon_mode ?? '',
        hubIconSymbol: selectedHub.hub_icon_symbol ?? '',
        hubIconBgMode: selectedHub.hub_icon_bg_mode ?? '',
        hubIconGradientFrom: selectedHub.hub_icon_gradient_from ?? '',
        hubIconGradientTo: selectedHub.hub_icon_gradient_to ?? '',
        hubIconSolidColor: selectedHub.hub_icon_solid_color ?? '',
        hubIconImageFileName: selectedHub.hub_icon_image_file_name ?? '',
      },
    });
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ThemedView style={[styles.container, styles.transparentBg]}>
        <AuthBackground />
      {/* A panel, not edge-to-edge, for the same reason login.tsx uses a card:
          the content underneath is a moving video, not the app's own themed
          background — rows/text need a stable, opaque-enough surface. Sized to
          content (not flex: 1) and anchored to the bottom via the container's
          justifyContent, so with only a few hubs the panel stays compact and
          the video shows through above it, the same way login's card does —
          the hub list itself is capped/scrollable so a long list still can't
          push the panel to fill the screen. */}
      <View
        style={[
          styles.panel,
          { backgroundColor: colorScheme === 'dark' ? 'rgba(21,23,24,0.86)' : 'rgba(255,255,255,0.9)' },
        ]}>
        <ThemedText type="title" style={styles.heading}>
          Find your hub
        </ThemedText>
        <ThemedText style={styles.subheading}>Search by name or pick from the list.</ThemedText>

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search hubs"
          placeholderTextColor={Colors[colorScheme].icon}
          style={[styles.searchInput, { color: Colors[colorScheme].text }]}
        />

        {loading && <ActivityIndicator style={styles.spinner} />}
        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        <FlatList
          data={filtered}
          keyExtractor={(hub) => hub.id}
          style={styles.listBox}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const selected = item.id === selectedId;
            return (
              <Pressable
                onPress={() => setSelectedId(item.id)}
                style={[styles.row, selected && { backgroundColor: tint + '15' }]}>
                <HubIcon
                  hub={item}
                  tunnelUrl={item.tunnel_url}
                  size={44}
                  style={styles.avatar}
                  fallback={<HubLetterFallback letter={item.name.charAt(0).toUpperCase()} size={44} />}
                />
                <View style={styles.rowText}>
                  <ThemedText type="defaultSemiBold">{item.name}</ThemedText>
                  <ThemedText style={styles.rowMeta}>
                    {item.location}
                    {typeof item.member_count === 'number' ? ` · ${item.member_count} neighbors` : ''}
                  </ThemedText>
                </View>
                <IconSymbol
                  name={selected ? 'checkmark.circle.fill' : 'circle'}
                  size={22}
                  color={selected ? tint : Colors[colorScheme].icon}
                />
              </Pressable>
            );
          }}
          ListEmptyComponent={
            !loading ? <ThemedText style={styles.rowMeta}>No hubs match your search.</ThemedText> : null
          }
        />

        <Pressable
          onPress={handleContinue}
          disabled={!selectedHub}
          style={[styles.continueButton, { opacity: selectedHub ? 1 : 0.4 }]}>
          <BrandGradient style={styles.continueFill}>
            <ThemedText style={styles.continueLabel} lightColor="#fff" darkColor="#fff">
              Continue
            </ThemedText>
          </BrandGradient>
        </Pressable>
      </View>
      </ThemedView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  transparentBg: {
    backgroundColor: 'transparent',
  },
  panel: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  heading: {
    marginBottom: 4,
  },
  subheading: {
    marginBottom: 16,
    opacity: 0.7,
  },
  searchInput: {
    backgroundColor: '#8881',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 12,
  },
  spinner: {
    marginTop: 24,
  },
  error: {
    color: '#b0392f',
    marginBottom: 12,
  },
  // Caps how tall the hub list can grow before it scrolls internally — without
  // this a long hub list would keep expanding the panel (flex-sized to
  // content) until it swallowed the whole screen, the same problem as before.
  listBox: {
    maxHeight: 260,
  },
  list: {
    paddingBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowMeta: {
    opacity: 0.6,
    fontSize: 13,
  },
  continueButton: {
    height: 52,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 24,
  },
  continueFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
});
