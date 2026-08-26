import { useEffect, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';

import { LeafletMap } from '@/components/atlas/leaflet-map';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { openDirections } from '@/lib/atlas/directions';
import { geocodeLocation, NominatimResult } from '@/lib/atlas/geocoding';
import { useHubCenter } from '@/lib/atlas/hub-center';
import { useGeocodeSuggestions } from '@/lib/atlas/use-geocode-suggestions';
import { useSession } from '@/lib/session/session-context';

function shortLabel(result: NominatimResult): string {
  return result.display_name.split(',')[0]?.trim() || result.display_name;
}

// Reached from components/event-atlas-link.tsx when an event's location
// text doesn't match any existing Atlas pin by title — landing on the plain
// Atlas map with a dropped marker and a dead-end "no pins match your
// search" list wasn't useful (a real user-reported gap: they wanted
// Directions/Share/bookmark-style actions for a place, not a pin browser).
// This is the pin-detail screen's own shape (banner/title/actions) applied
// to a place that ISN'T a saved pin yet — Directions and Share work
// immediately since both only ever needed coordinates, and "Add this to the
// Atlas" is the bridge into actually becoming one, pre-filled into the real
// editor rather than inventing a fake in-between entity.
//
// Auto-geocoding is now bounded to near the hub (see lib/atlas/geocoding.ts's
// HUB_BOUND_DEGREES) — a hub is one community's own local project, not a
// global directory, so an ambiguous place name should never silently
// resolve to a same-named place on another continent. The real consequence
// of bounding, though, is that a genuine miss becomes more likely (a typo,
// or a location that really is outside that radius) — so unlike before,
// that's never a bare error screen. The full banner/actions shell still
// renders (Directions/Share just gray out, nothing to act on yet) alongside
// a real search box so the person can find the right place themselves.
export default function LocationPreviewScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const hubCenter = useHubCenter();
  const { lat: latParam, lng: lngParam, query, title, eventId } = useLocalSearchParams<{
    lat?: string;
    lng?: string;
    query?: string;
    title?: string;
    eventId?: string;
  }>();

  const [coords, setCoords] = useState<[number, number] | null>(
    latParam && lngParam ? [parseFloat(latParam), parseFloat(lngParam)] : null
  );
  const [resolving, setResolving] = useState(!coords);
  // True once the initial auto-resolve attempt has run and found nothing —
  // distinct from "still resolving," this is what triggers the recovery UI
  // (grayed actions + search box) instead of a dead-end error message.
  const [notFound, setNotFound] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [manualQuery, setManualQuery] = useState('');
  const { suggestions, showSuggestions, setShowSuggestions } = useGeocodeSuggestions(manualQuery, hubCenter);

  // useHubCenter() always starts at null and resolves a beat later (even
  // when its result is cached from an earlier screen this session, since
  // the cache lookup still happens inside an async function) — so without
  // this gate, the geocode effect below would fire once unbounded on first
  // mount, then again once hubCenter arrives, and an unbounded hit that
  // happens to land before the bounded retry would stick as `coords`
  // (the effect short-circuits once coords is set, it never re-validates).
  // Proceeding after a short timeout either way means a hub with no
  // location configured at all doesn't hang here forever.
  const [hubCenterSettled, setHubCenterSettled] = useState(false);
  useEffect(() => {
    if (hubCenter) {
      setHubCenterSettled(true);
      return;
    }
    const timeout = setTimeout(() => setHubCenterSettled(true), 600);
    return () => clearTimeout(timeout);
  }, [hubCenter]);

  useEffect(() => {
    if (coords) {
      setResolving(false);
      return;
    }
    if (!query?.trim()) {
      setResolving(false);
      setNotFound(true);
      return;
    }
    if (!hubCenterSettled) return;
    let cancelled = false;
    geocodeLocation(query.trim(), hubCenter ?? undefined)
      .then((result) => {
        if (cancelled) return;
        if (result) setCoords(result);
        else setNotFound(true);
      })
      .finally(() => !cancelled && setResolving(false));
    return () => {
      cancelled = true;
    };
  }, [query, coords, hubCenter, hubCenterSettled]);

  const displayTitle = title?.trim() || query?.trim() || 'Location';
  const displaySubtitle = query?.trim() && query.trim() !== displayTitle ? query.trim() : null;

  function selectSuggestion(result: NominatimResult) {
    setCoords([parseFloat(result.lat), parseFloat(result.lon)]);
    setNotFound(false);
    setShowSuggestions(false);
  }

  async function handleSubmitManualSearch() {
    const q = manualQuery.trim();
    if (!q) return;
    if (suggestions.length > 0) {
      selectSuggestion(suggestions[0]);
      return;
    }
    const result = await geocodeLocation(q, hubCenter ?? undefined);
    if (result) {
      setCoords(result);
      setNotFound(false);
    }
  }

  function handleDirections() {
    if (!coords) return;
    openDirections(coords[0], coords[1], displayTitle).catch(() => setActionError("Couldn't open your maps app."));
  }

  function handleShare() {
    if (!coords) return;
    Share.share({ message: `${displayTitle}\nhttps://www.google.com/maps?q=${coords[0]},${coords[1]}` }).catch(() => {});
  }

  function handleCreatePin() {
    router.push({
      pathname: '/atlas/editor',
      params: coords
        ? { lat: String(coords[0]), lng: String(coords[1]), title: title ?? '', category: 'meetup' }
        : { title: title ?? '', category: 'meetup' },
    });
  }

  if (!session) return null;

  return (
    <ThemedView style={styles.flex}>
      <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back" accessibilityRole="button">
            <IconSymbol name="chevron.left" size={24} color={Colors[colorScheme].text} />
          </Pressable>
          <ThemedText type="defaultSemiBold" style={styles.title}>
            Location
          </ThemedText>
          <View style={{ width: 24 }} />
        </View>

        {resolving ? (
          <ActivityIndicator style={styles.spinner} />
        ) : (
          // keyboardShouldPersistTaps="handled" below (needed so a suggestion
          // row's own tap still works while the keyboard is up) suppresses the
          // ScrollView's normal tap-elsewhere-dismisses-keyboard default, so
          // this Pressable puts that back explicitly — same pattern as
          // files/index, atlas/index, marketplace/index, notes/index.
          <Pressable style={styles.flex} onPress={Keyboard.dismiss}>
          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
            contentInsetAdjustmentBehavior="automatic">
            {actionError && <ThemedText style={styles.error}>{actionError}</ThemedText>}

            <View style={styles.banner}>
              {coords ? (
                <>
                  <LeafletMap pins={[]} center={coords} zoom={16} style={StyleSheet.absoluteFill} />
                  {/* Decorative close-up, not an interactive map — same
                      reasoning as Pin Detail's own map-fallback banner: a
                      WebView inside a ScrollView will fight the outer scroll
                      gesture unless taps/drags are captured here instead of
                      reaching it. */}
                  <View style={StyleSheet.absoluteFill} />
                </>
              ) : (
                <View style={[StyleSheet.absoluteFill, styles.bannerFallback]}>
                  <IconSymbol name="mappin.and.ellipse" size={26} color={Colors[colorScheme].icon} />
                  <ThemedText style={styles.bannerFallbackLabel}>Location not found nearby</ThemedText>
                </View>
              )}
            </View>

            <ThemedText type="title" style={styles.pinTitle}>
              {displayTitle}
            </ThemedText>
            {displaySubtitle && <ThemedText style={styles.subMeta}>{displaySubtitle}</ThemedText>}

            {!!eventId && (
              <Pressable
                style={styles.eventBackLink}
                onPress={() => router.push({ pathname: '/post/[id]', params: { id: eventId } })}>
                <IconSymbol name="calendar" size={14} color={Brand} />
                <ThemedText style={[styles.eventBackLinkLabel, { color: Brand }]}>View the event post</ThemedText>
              </Pressable>
            )}

            <View style={styles.actions}>
              <Pressable style={[styles.actionButton, !coords && styles.actionButtonDisabled]} disabled={!coords} onPress={handleDirections}>
                <IconSymbol name="arrow.triangle.turn.up.right.diamond.fill" size={17} color={Colors[colorScheme].text} />
                <ThemedText style={styles.actionLabel}>Directions</ThemedText>
              </Pressable>
              <Pressable style={[styles.actionButton, !coords && styles.actionButtonDisabled]} disabled={!coords} onPress={handleShare}>
                <IconSymbol name="square.and.arrow.up" size={17} color={Colors[colorScheme].text} />
                <ThemedText style={styles.actionLabel}>Share</ThemedText>
              </Pressable>
            </View>

            {notFound && (
              <View style={styles.recovery}>
                <ThemedText style={styles.recoveryHint}>
                  We couldn&apos;t automatically place this near the hub. Search for the real spot below.
                </ThemedText>
                <View style={styles.searchRow}>
                  <IconSymbol name="magnifyingglass" size={17} color={Colors[colorScheme].icon} />
                  <TextInput
                    value={manualQuery}
                    onChangeText={setManualQuery}
                    onSubmitEditing={handleSubmitManualSearch}
                    onFocus={() => setShowSuggestions(suggestions.length > 0)}
                    returnKeyType="search"
                    placeholder="Search for this place"
                    placeholderTextColor={Colors[colorScheme].icon}
                    style={[styles.searchInput, { color: Colors[colorScheme].text }]}
                  />
                </View>
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
              </View>
            )}

            <Pressable style={styles.createPinButton} onPress={handleCreatePin}>
              <IconSymbol name="plus" size={16} color="#fff" />
              <ThemedText style={styles.createPinLabel} lightColor="#fff" darkColor="#fff">
                Add this to the Atlas
              </ThemedText>
            </Pressable>
            <ThemedText style={styles.createPinHint}>
              {coords
                ? "This isn't a saved pin yet — add it so neighbors can find it here too."
                : "Drop it on the map yourself in the editor — we just couldn't place it automatically."}
            </ThemedText>

            <Pressable onPress={() => router.push('/atlas' as Href)} style={styles.viewMapLink}>
              <ThemedText style={[styles.viewMapLinkLabel, { color: Brand }]}>View full Atlas map</ThemedText>
            </Pressable>
          </ScrollView>
          </Pressable>
        )}
      </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
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
  spinner: {
    marginTop: 40,
  },
  error: {
    color: '#b0392f',
    fontSize: 13,
    marginBottom: 12,
  },
  body: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  banner: {
    height: 120,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
    backgroundColor: '#8881',
  },
  bannerFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  bannerFallbackLabel: {
    fontSize: 12.5,
    opacity: 0.6,
  },
  pinTitle: {
    fontSize: 22,
    marginBottom: 4,
  },
  subMeta: {
    opacity: 0.6,
    fontSize: 13.5,
  },
  eventBackLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  eventBackLinkLabel: {
    fontSize: 13.5,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 20,
    marginBottom: 20,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#8881',
  },
  actionButtonDisabled: {
    opacity: 0.4,
  },
  actionLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  recovery: {
    marginBottom: 20,
  },
  recoveryHint: {
    fontSize: 13,
    lineHeight: 18,
    opacity: 0.7,
    marginBottom: 10,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  createPinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Brand,
    borderRadius: 10,
    paddingVertical: 13,
  },
  createPinLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  createPinHint: {
    fontSize: 12,
    opacity: 0.5,
    lineHeight: 16,
    marginTop: 8,
    textAlign: 'center',
  },
  viewMapLink: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  viewMapLinkLabel: {
    fontSize: 13.5,
    fontWeight: '600',
  },
});
