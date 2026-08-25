import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { LeafletMap } from '@/components/atlas/leaflet-map';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { listAtlasPins } from '@/lib/api/hubService';
import { AtlasPin, AtlasPinCategory } from '@/lib/api/types';
import { ATLAS_CATEGORIES, ATLAS_CATEGORY_ORDER } from '@/lib/atlas/categories';
import { distanceMeters, formatDistanceMiles, geocodeLocation, NominatimResult } from '@/lib/atlas/geocoding';
import { DEFAULT_MAP_CENTER, fallbackMapZoom, useHubCenter } from '@/lib/atlas/hub-center';
import { useGeocodeSuggestions } from '@/lib/atlas/use-geocode-suggestions';
import { useSavedPins } from '@/lib/atlas/saved-pins';
import { useSession } from '@/lib/session/session-context';

type CategoryFilter = 'all' | AtlasPinCategory;

// A short, single-line label for a Nominatim result — display_name is a full
// comma-separated address ("123 Main St, Springfield, ... , USA"), too long
// for a suggestion row's first line.
function shortLabel(result: NominatimResult): string {
  return result.display_name.split(',')[0]?.trim() || result.display_name;
}

export default function AtlasScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const hubCenter = useHubCenter();
  const { isSaved, toggleSaved } = useSavedPins();
  const { saved: savedParam, query: queryParam } = useLocalSearchParams<{ saved?: string; query?: string }>();

  const [pins, setPins] = useState<AtlasPin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(queryParam ?? '');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  // Pre-applied when opened from Profile → "Saved pins" (?saved=true); still a
  // normal toggle afterward, same header button either way.
  const [savedOnly, setSavedOnly] = useState(savedParam === 'true');

  // Real-world location search (Nominatim), layered on top of the existing
  // pin-title/description filter below — typing narrows the pin list AND
  // (once there's real signal) offers actual places to travel the map to,
  // not just pins that already exist here. `searchedLocation` is what the
  // map actually travels to; it's independent from `query` so map position
  // doesn't jump on every keystroke, only on a real pick/submit.
  const { suggestions, showSuggestions, setShowSuggestions } = useGeocodeSuggestions(query, hubCenter);
  const [searchedLocation, setSearchedLocation] = useState<{ lat: number; lng: number } | null>(null);

  // Clearing the search box resets the map back to its normal all-pins view.
  useEffect(() => {
    if (!query.trim()) setSearchedLocation(null);
  }, [query]);

  function travelTo(lat: number, lng: number) {
    setSearchedLocation({ lat, lng });
    setShowSuggestions(false);
    Keyboard.dismiss();
  }

  // Picking a suggestion travels the map there immediately — the query text
  // itself is left as typed (not overwritten with the full address), so it
  // keeps working as a plain pin-title filter too.
  function selectSuggestion(result: NominatimResult) {
    travelTo(parseFloat(result.lat), parseFloat(result.lon));
  }

  // Enter/submit: reuse the top already-fetched suggestion when there is one
  // (avoids a duplicate network call for the common case of typing then
  // hitting enter), otherwise geocode the raw text directly.
  async function handleSubmitSearch() {
    const q = query.trim();
    if (!q) return;
    if (suggestions.length > 0) {
      selectSuggestion(suggestions[0]);
      return;
    }
    const coords = await geocodeLocation(q, hubCenter ?? undefined);
    if (coords) travelTo(coords[0], coords[1]);
  }

  // A generic `?query=` deep-link entry point — e.g. `/atlas?query=<place>` —
  // travels the map there on arrival rather than leaving a pre-filled search
  // box the user still has to submit themselves. (EventAtlasLink's own
  // fallback no longer uses this path — an unresolved event location now
  // goes to app/atlas/location.tsx instead, which has real recovery UI for
  // the "couldn't find it" case — but this stays useful as a general
  // deep-link shape into Atlas.)
  useEffect(() => {
    if (!queryParam?.trim()) return;
    geocodeLocation(queryParam.trim(), hubCenter ?? undefined).then((coords) => {
      if (coords) setSearchedLocation({ lat: coords[0], lng: coords[1] });
    });
  }, [queryParam, hubCenter]);

  const load = useCallback(() => {
    if (!session) return;
    setLoading(true);
    setError(null);
    listAtlasPins(session.hub.tunnelUrl, session.token)
      .then(setPins)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load the atlas.'))
      .finally(() => setLoading(false));
  }, [session]);

  useFocusEffect(load);

  const filtered = useMemo(() => {
    let next = categoryFilter === 'all' ? pins : pins.filter((p) => p.category === categoryFilter);
    if (savedOnly) next = next.filter((p) => isSaved(p.id));
    const q = query.trim().toLowerCase();
    if (q) {
      next = next.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          (p.description ?? '').toLowerCase().includes(q) ||
          (p.author_username ?? '').toLowerCase().includes(q) ||
          ATLAS_CATEGORIES[p.category].label.toLowerCase().includes(q)
      );
    }
    return next;
  }, [pins, categoryFilter, savedOnly, isSaved, query]);

  const withDistance = useMemo(
    () =>
      filtered
        .map((p) => ({
          pin: p,
          meters: hubCenter ? distanceMeters(hubCenter[0], hubCenter[1], p.latitude, p.longitude) : null,
        }))
        .sort((a, b) => (a.meters ?? 0) - (b.meters ?? 0)),
    [filtered, hubCenter]
  );

  const mapCenter = hubCenter ?? DEFAULT_MAP_CENTER;

  if (!session) return null;

  return (
    <ThemedView style={styles.flex}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back" accessibilityRole="button">
          <IconSymbol name="chevron.left" size={24} color={Colors[colorScheme].text} />
        </Pressable>
        <ThemedText type="defaultSemiBold" style={styles.title}>
          Atlas
        </ThemedText>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => setSavedOnly((v) => !v)}
            hitSlop={12}
            accessibilityLabel={savedOnly ? 'Show all pins' : 'Show saved pins only'}
            accessibilityRole="button">
            <IconSymbol name={savedOnly ? 'bookmark.fill' : 'bookmark'} size={22} color={savedOnly ? Brand : Colors[colorScheme].text} />
          </Pressable>
          <Pressable onPress={() => router.push('/atlas/editor')} hitSlop={12} accessibilityLabel="New pin" accessibilityRole="button">
            <IconSymbol name="plus" size={24} color={Colors[colorScheme].text} />
          </Pressable>
        </View>
      </View>

      <LeafletMap
        pins={filtered}
        center={searchedLocation ? [searchedLocation.lat, searchedLocation.lng] : mapCenter}
        zoom={searchedLocation ? 15 : fallbackMapZoom(hubCenter)}
        // A searched real-world location takes over from the usual
        // fit-every-pin view — the whole point of searching is to travel
        // somewhere specific, not to keep showing every pin at once.
        fitToPins={!searchedLocation}
        pendingMarker={searchedLocation ? [searchedLocation.lat, searchedLocation.lng] : null}
        onMarkerPress={(id) => router.push({ pathname: '/atlas/[id]', params: { id } })}
        style={styles.map}
      />

      <View style={styles.searchRow}>
        <IconSymbol name="magnifyingglass" size={17} color={Colors[colorScheme].icon} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={handleSubmitSearch}
          onFocus={() => setShowSuggestions(suggestions.length > 0)}
          returnKeyType="search"
          placeholder="Search pins or a real-world place"
          placeholderTextColor={Colors[colorScheme].icon}
          style={[styles.searchInput, { color: Colors[colorScheme].text }]}
        />
        {!!query && (
          <Pressable
            onPress={() => {
              setQuery('');
              setShowSuggestions(false);
            }}
            hitSlop={8}
            accessibilityLabel="Clear search">
            <IconSymbol name="xmark" size={15} color={Colors[colorScheme].icon} />
          </Pressable>
        )}
      </View>

      {/* Renders inline, in-flow (not absolutely positioned) — pushes the
          category chips/pin list down while open rather than floating over
          them, since RN has no reliable cross-platform way for an
          absolutely-positioned child to paint above unrelated later
          siblings without a portal. Same "search state changes what's below
          it" precedent as Discover's own search results view. */}
      {showSuggestions && (
        <View style={styles.suggestionsBox}>
          {suggestions.map((result) => (
            <Pressable key={result.place_id} style={styles.suggestionRow} onPress={() => selectSuggestion(result)}>
              <IconSymbol name="mappin.and.ellipse" size={15} color={Colors[colorScheme].icon} />
              <View style={styles.suggestionText}>
                <ThemedText numberOfLines={1} type="defaultSemiBold" style={styles.suggestionTitle}>
                  {shortLabel(result)}
                </ThemedText>
                <ThemedText numberOfLines={1} style={styles.suggestionSubtitle}>
                  {result.display_name}
                </ThemedText>
              </View>
            </Pressable>
          ))}
        </View>
      )}

      <View style={styles.chipsWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          <Pressable onPress={() => setCategoryFilter('all')} style={[styles.chip, categoryFilter === 'all' && { backgroundColor: Brand }]}>
            <ThemedText style={styles.chipLabel} lightColor={categoryFilter === 'all' ? '#fff' : undefined} darkColor={categoryFilter === 'all' ? '#fff' : undefined}>
              All
            </ThemedText>
          </Pressable>
          {ATLAS_CATEGORY_ORDER.map((cat) => {
            const meta = ATLAS_CATEGORIES[cat];
            const active = categoryFilter === cat;
            return (
              <Pressable key={cat} onPress={() => setCategoryFilter(cat)} style={[styles.chip, active && { backgroundColor: meta.color }]}>
                <IconSymbol name={meta.icon} size={13} color={active ? '#fff' : Colors[colorScheme].icon} />
                <ThemedText style={styles.chipLabel} lightColor={active ? '#fff' : undefined} darkColor={active ? '#fff' : undefined}>
                  {meta.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {loading && pins.length === 0 && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      {/* Explicit flex:1 on both the wrapper and the FlatList itself — without
          this, the list has no bounded height of its own (only
          contentContainerStyle, which sizes to content, not the parent), so a
          long list expands the column and pushes/collapses the map's layout
          above it instead of scrolling within whatever space is left. Same
          "enforce the bound from outside" pattern as Discover's listWrap. */}
      <Pressable
        style={styles.listWrap}
        onPress={() => {
          Keyboard.dismiss();
          setShowSuggestions(false);
        }}>
        <FlatList
          data={withDistance}
          keyExtractor={({ pin }) => pin.id}
          style={styles.listFlex}
          contentContainerStyle={styles.list}
          onRefresh={load}
          refreshing={loading}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const meta = ATLAS_CATEGORIES[item.pin.category];
            const saved = isSaved(item.pin.id);
            return (
              <Pressable style={styles.row} onPress={() => router.push({ pathname: '/atlas/[id]', params: { id: item.pin.id } })}>
                <View style={[styles.rowIcon, { backgroundColor: meta.color }]}>
                  <IconSymbol name={meta.icon} size={16} color="#fff" />
                </View>
                <View style={styles.rowText}>
                  <ThemedText type="defaultSemiBold" numberOfLines={1}>
                    {item.pin.title}
                  </ThemedText>
                  <ThemedText style={styles.rowMeta}>
                    {meta.label}
                    {item.meters !== null ? ` · ${formatDistanceMiles(item.meters)}` : ''}
                  </ThemedText>
                </View>
                <Pressable onPress={() => toggleSaved(item.pin.id)} hitSlop={10} accessibilityLabel={saved ? 'Unsave' : 'Save'}>
                  <IconSymbol name={saved ? 'bookmark.fill' : 'bookmark'} size={19} color={saved ? Brand : Colors[colorScheme].icon} />
                </Pressable>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            !loading ? (
              <ThemedText style={styles.empty}>
                {query.trim()
                  ? 'No pins match your search.'
                  : savedOnly
                    ? 'No saved pins yet — tap the bookmark on any pin to save it here.'
                    : 'No pins yet — be the first to drop one.'}
              </ThemedText>
            ) : null
          }
        />
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  listWrap: {
    flex: 1,
  },
  listFlex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
  },
  title: {
    fontSize: 17,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  map: {
    height: 220,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: '#8881',
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    padding: 0,
  },
  suggestionsBox: {
    marginHorizontal: 20,
    marginTop: 8,
    borderRadius: 10,
    backgroundColor: '#8881',
    overflow: 'hidden',
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  suggestionText: {
    flex: 1,
    gap: 1,
  },
  suggestionTitle: {
    fontSize: 14,
  },
  suggestionSubtitle: {
    fontSize: 11.5,
    opacity: 0.55,
  },
  chipsWrap: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#8881',
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  spinner: {
    marginTop: 24,
  },
  error: {
    color: '#b0392f',
    paddingHorizontal: 20,
    marginVertical: 8,
  },
  list: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 40,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowMeta: {
    fontSize: 12.5,
    opacity: 0.6,
  },
  empty: {
    opacity: 0.6,
    fontSize: 13,
    marginTop: 16,
    textAlign: 'center',
  },
});
