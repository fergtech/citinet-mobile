import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AuthBackground } from '@/components/auth-background';
import { BrandGradient } from '@/components/brand-gradient';
import { HubIcon, HubLetterFallback } from '@/components/hub-icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getHubInfo } from '@/lib/api/hubService';
import { getHubs } from '@/lib/api/registryService';
import { RegistryHub } from '@/lib/api/types';
import { isNearbyDiscoveryAvailable, useNearbyHubs } from '@/lib/discovery/nearbyHubs';

export default function HubSelectScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const tint = Colors[colorScheme].tint;

  const [hubs, setHubs] = useState<RegistryHub[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const nearbyHubs = useNearbyHubs();

  const [manualOpen, setManualOpen] = useState(false);
  const [manualAddress, setManualAddress] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

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

  const selectedHub = hubs.find((hub) => hub.id === selectedId) ?? nearbyHubs.find((hub) => hub.id === selectedId) ?? null;

  function navigateToLogin(hub: RegistryHub) {
    router.push({
      pathname: '/(auth)/login',
      params: {
        hubId: hub.id,
        hubSlug: hub.slug,
        hubName: hub.name,
        tunnelUrl: hub.tunnel_url,
        location: hub.location ?? '',
        hubIconMode: hub.hub_icon_mode ?? '',
        hubIconSymbol: hub.hub_icon_symbol ?? '',
        hubIconBgMode: hub.hub_icon_bg_mode ?? '',
        hubIconGradientFrom: hub.hub_icon_gradient_from ?? '',
        hubIconGradientTo: hub.hub_icon_gradient_to ?? '',
        hubIconSolidColor: hub.hub_icon_solid_color ?? '',
        hubIconImageFileName: hub.hub_icon_image_file_name ?? '',
      },
    });
  }

  function handleContinue() {
    if (!selectedHub) return;
    navigateToLogin(selectedHub);
  }

  async function handleManualConnect() {
    const address = manualAddress.trim();
    if (!address) return;
    setManualBusy(true);
    setManualError(null);
    try {
      const tunnelUrl = /^https?:\/\//i.test(address) ? address : `http://${address}`;
      const info = await getHubInfo(tunnelUrl);
      navigateToLogin({
        id: tunnelUrl,
        name: info.hub_name,
        slug: info.hub_slug,
        location: info.location,
        tunnel_url: tunnelUrl,
      });
    } catch (err) {
      setManualError(err instanceof Error ? err.message : "Couldn't reach that address.");
    } finally {
      setManualBusy(false);
    }
  }

  function hubMetaLine(item: RegistryHub): string {
    const parts: string[] = [];
    if (item.location) parts.push(item.location);
    if (typeof item.member_count === 'number') parts.push(`${item.member_count} neighbors`);
    // online_now/uptime only ever come from live heartbeat enrichment
    // (Layer 3) -- registry-sourced Directory entries never have them, so
    // this naturally only shows on enriched Nearby rows.
    if (typeof item.online_now === 'number') {
      parts.push(item.online_now > 0 ? `${item.online_now} online now` : 'online');
    }
    return parts.join(' · ');
  }

  function renderHubRow(item: RegistryHub) {
    const selected = item.id === selectedId;
    const live = typeof item.online_now === 'number';
    return (
      <Pressable
        key={item.id}
        onPress={() => setSelectedId(item.id)}
        style={[styles.row, selected && { backgroundColor: tint + '15' }]}>
        <View style={styles.avatarWrap}>
          <HubIcon
            hub={item}
            tunnelUrl={item.tunnel_url}
            size={44}
            fallback={<HubLetterFallback letter={item.name.charAt(0).toUpperCase()} size={44} />}
          />
          {live && <View style={styles.liveDot} />}
        </View>
        <View style={styles.rowText}>
          <ThemedText type="defaultSemiBold">{item.name}</ThemedText>
          <ThemedText style={styles.rowMeta}>{hubMetaLine(item)}</ThemedText>
        </View>
        <IconSymbol
          name={selected ? 'checkmark.circle.fill' : 'circle'}
          size={22}
          color={selected ? tint : Colors[colorScheme].icon}
        />
      </Pressable>
    );
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

      {nearbyHubs.length > 0 && (
        <View style={styles.nearbySection}>
          <ThemedText style={styles.sectionLabel}>Nearby</ThemedText>
          {nearbyHubs.map(renderHubRow)}
        </View>
      )}

      {__DEV__ && !isNearbyDiscoveryAvailable && (
        <ThemedText style={styles.devNote}>
          Nearby hub discovery needs a development build — disabled in Expo Go.
        </ThemedText>
      )}

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search hubs"
        placeholderTextColor={Colors[colorScheme].icon}
        style={[styles.searchInput, { color: Colors[colorScheme].text, borderColor: Colors[colorScheme].icon }]}
      />

        {loading && <ActivityIndicator style={styles.spinner} />}
        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      <ThemedText style={styles.sectionLabel}>Directory</ThemedText>
      <FlatList
        data={filtered}
        keyExtractor={(hub) => hub.id}
        style={styles.listBox}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => renderHubRow(item)}
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

      <Pressable onPress={() => setManualOpen((v) => !v)} style={styles.manualToggle}>
        <ThemedText style={[styles.manualToggleLabel, { color: tint }]}>
          {manualOpen ? 'Hide manual entry' : 'Enter hub address manually'}
        </ThemedText>
      </Pressable>

      {manualOpen && (
        <View style={styles.manualSection}>
          <TextInput
            value={manualAddress}
            onChangeText={setManualAddress}
            placeholder="192.168.1.50:9090"
            autoCapitalize="none"
            autoCorrect={false}
            placeholderTextColor={Colors[colorScheme].icon}
            style={[styles.searchInput, { color: Colors[colorScheme].text, borderColor: Colors[colorScheme].icon }]}
          />
          {manualError && <ThemedText style={styles.error}>{manualError}</ThemedText>}
          <Pressable
            onPress={handleManualConnect}
            disabled={manualBusy || !manualAddress.trim()}
            style={[styles.continueButton, { opacity: manualBusy || !manualAddress.trim() ? 0.4 : 1 }]}>
            <BrandGradient style={styles.continueFill}>
              {manualBusy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <ThemedText style={styles.continueLabel} lightColor="#fff" darkColor="#fff">
                  Connect
                </ThemedText>
              )}
            </BrandGradient>
          </Pressable>
        </View>
      )}
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
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  devNote: {
    fontSize: 12,
    opacity: 0.5,
    fontStyle: 'italic',
    marginBottom: 12,
  },
  nearbySection: {
    marginBottom: 16,
  },
  manualToggle: {
    alignSelf: 'center',
    paddingVertical: 12,
  },
  manualToggleLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  manualSection: {
    marginTop: 4,
    marginBottom: 12,
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
  avatarWrap: {
    position: 'relative',
  },
  liveDot: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#22c55e',
    borderWidth: 2,
    borderColor: '#8884',
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
