import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import { BrandGradient } from '@/components/brand-gradient';
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
      },
    });
  }

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title" style={styles.heading}>
        Find your hub
      </ThemedText>
      <ThemedText style={styles.subheading}>Search by name or pick from the list.</ThemedText>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search hubs"
        placeholderTextColor={Colors[colorScheme].icon}
        style={[styles.searchInput, { color: Colors[colorScheme].text, borderColor: Colors[colorScheme].icon }]}
      />

      {loading && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      <FlatList
        data={filtered}
        keyExtractor={(hub) => hub.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const selected = item.id === selectedId;
          return (
            <Pressable
              onPress={() => setSelectedId(item.id)}
              style={[styles.row, selected && { backgroundColor: tint + '15' }]}>
              <BrandGradient style={styles.avatar}>
                <ThemedText style={styles.avatarText} lightColor="#fff" darkColor="#fff">
                  {item.name.charAt(0).toUpperCase()}
                </ThemedText>
              </BrandGradient>
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
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  heading: {
    marginBottom: 4,
  },
  subheading: {
    marginBottom: 16,
    opacity: 0.7,
  },
  searchInput: {
    borderWidth: 1,
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
  avatarText: {
    fontSize: 18,
    fontWeight: '600',
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
