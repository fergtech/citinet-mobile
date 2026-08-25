import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams, type Href } from 'expo-router';

import { LeafletMap } from '@/components/atlas/leaflet-map';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { deleteAtlasPin, getMediaUrl, listAtlasPins } from '@/lib/api/hubService';
import { AtlasPin } from '@/lib/api/types';
import { ATLAS_CATEGORIES } from '@/lib/atlas/categories';
import { openDirections } from '@/lib/atlas/directions';
import { distanceMeters, formatDistanceMiles } from '@/lib/atlas/geocoding';
import { useHubCenter } from '@/lib/atlas/hub-center';
import { findNearestPanoramaxImage, type PanoramaxImage } from '@/lib/atlas/panoramax';
import { useSavedPins } from '@/lib/atlas/saved-pins';
import { useSession } from '@/lib/session/session-context';
import { confirmDestructive } from '@/lib/ui/confirm';

export default function PinDetailScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const hubCenter = useHubCenter();
  const { isSaved, toggleSaved } = useSavedPins();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [pin, setPin] = useState<AtlasPin | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Shown for ~4s after a fresh save only (not on unsave) — see handleToggleSaved.
  const [pinSavedFeedback, setPinSavedFeedback] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [panoramax, setPanoramax] = useState<PanoramaxImage | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    // No single-pin GET route on the server (only list/create/patch/delete) —
    // fetch the list and find it, same shape citinet web itself has to work with.
    listAtlasPins(session.hub.tunnelUrl, session.token)
      .then((pins) => {
        if (cancelled) return;
        const found = pins.find((p) => p.id === id) ?? null;
        if (!found) setError('Pin not found.');
        setPin(found);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load this pin.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, id]);

  useEffect(() => {
    if (!session || !pin?.image_file_name) return;
    let cancelled = false;
    getMediaUrl(session.hub.tunnelUrl, session.token, pin.image_file_name)
      .then((url) => !cancelled && setImageUrl(url))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session, pin?.image_file_name]);

  // Only checked when the pin has no uploaded photo — a real photo the owner
  // chose always wins. Panoramax coverage is real but geographically limited
  // (see lib/atlas/panoramax.ts), so the common case is finding nothing —
  // the map fallback below renders immediately either way and silently gets
  // swapped out if/when this resolves with a real nearby match, rather than
  // making every pin wait on a network round-trip before showing anything.
  useEffect(() => {
    if (!pin || pin.image_file_name) return;
    let cancelled = false;
    findNearestPanoramaxImage(pin.latitude, pin.longitude).then((match) => {
      if (!cancelled && match) setPanoramax(match);
    });
    return () => {
      cancelled = true;
    };
  }, [pin]);

  function handleDirections() {
    if (!pin) return;
    openDirections(pin.latitude, pin.longitude, pin.title).catch(() => setError("Couldn't open your maps app."));
  }

  function handleToggleSaved() {
    if (!pin) return;
    const wasSaved = isSaved(pin.id);
    toggleSaved(pin.id);
    if (!wasSaved) {
      setPinSavedFeedback(true);
      setTimeout(() => setPinSavedFeedback(false), 4000);
    }
  }

  function confirmDelete() {
    if (!session || !pin) return;
    confirmDestructive('Delete this pin?', 'Delete', () => {
      deleteAtlasPin(session.hub.tunnelUrl, session.token, pin.id)
        .then(() => router.back())
        .catch((err) => setError(err instanceof Error ? err.message : "Couldn't delete this pin."));
    });
  }

  if (!session) return null;

  const meta = pin ? ATLAS_CATEGORIES[pin.category] : null;
  const meters = pin && hubCenter ? distanceMeters(hubCenter[0], hubCenter[1], pin.latitude, pin.longitude) : null;
  const isMine = pin?.author_username === session.username;
  const saved = pin ? isSaved(pin.id) : false;

  return (
    <ThemedView style={styles.flex}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back" accessibilityRole="button">
          <IconSymbol name="chevron.left" size={24} color={Colors[colorScheme].text} />
        </Pressable>
        <ThemedText type="defaultSemiBold" style={styles.title}>
          Pin
        </ThemedText>
        {isMine && pin ? (
          <Pressable onPress={() => router.push(`/atlas/editor?id=${pin.id}` as Href)} hitSlop={12} accessibilityLabel="Edit pin">
            <IconSymbol name="pencil" size={20} color={Colors[colorScheme].text} />
          </Pressable>
        ) : (
          <View style={{ width: 24 }} />
        )}
      </View>

      {loading && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      {pin && meta && (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.banner}>
            {pin.image_file_name ? (
              imageUrl ? (
                <Image source={{ uri: imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <View style={[StyleSheet.absoluteFill, styles.bannerFallback, { backgroundColor: meta.color }]}>
                  <ActivityIndicator color="#fff" />
                </View>
              )
            ) : panoramax ? (
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={() =>
                  router.push(
                    `/atlas/panoramax-view?image=${encodeURIComponent(panoramax.imageUrl)}&picture=${panoramax.pictureId}` as Href
                  )
                }
                accessibilityLabel="Open interactive street view"
                accessibilityRole="button">
                <Image source={{ uri: panoramax.thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
                <View style={styles.panoramax360Badge}>
                  <IconSymbol name="view.3d" size={12} color="#fff" />
                  <ThemedText style={styles.panoramax360BadgeLabel} lightColor="#fff" darkColor="#fff">
                    Explore street view
                  </ThemedText>
                </View>
                {/* etalab-2.0 (the license Panoramax's imagery is published
                    under) expects attribution on reuse. */}
                <View style={styles.panoramaxCredit}>
                  <ThemedText style={styles.panoramaxCreditLabel} lightColor="#fff" darkColor="#fff">
                    Street view via Panoramax
                  </ThemedText>
                </View>
              </Pressable>
            ) : (
              <>
                <LeafletMap pins={[pin]} center={[pin.latitude, pin.longitude]} zoom={17} style={StyleSheet.absoluteFill} />
                {/* Decorative close-up, not an interactive map — same reasoning
                    as Discover's map card: a WebView inside a ScrollView will
                    fight the outer scroll gesture unless taps/drags are
                    captured here instead of reaching the map underneath. */}
                <View style={StyleSheet.absoluteFill} />
              </>
            )}
          </View>

          <ThemedText type="title" style={styles.pinTitle}>
            {pin.title}
          </ThemedText>
          <ThemedText style={styles.subMeta}>
            {meta.label} · Added by {pin.author_username ?? 'someone'}
            {meters !== null ? ` · ${formatDistanceMiles(meters)}` : ''}
          </ThemedText>

          {pin.description && <ThemedText style={styles.description}>{pin.description}</ThemedText>}

          <View style={styles.actions}>
            <Pressable onPress={handleToggleSaved} style={[styles.actionButton, saved && { backgroundColor: Brand }]}>
              <IconSymbol name={saved ? 'bookmark.circle.fill' : 'bookmark'} size={17} color={saved ? '#fff' : Colors[colorScheme].text} />
              <ThemedText style={styles.actionLabel} lightColor={saved ? '#fff' : undefined} darkColor={saved ? '#fff' : undefined}>
                {saved ? 'Saved' : 'Save'}
              </ThemedText>
            </Pressable>
            <Pressable style={styles.actionButton} onPress={() => router.push(`/atlas/share?id=${pin.id}` as Href)}>
              <IconSymbol name="square.and.arrow.up" size={17} color={Colors[colorScheme].text} />
              <ThemedText style={styles.actionLabel}>Share</ThemedText>
            </Pressable>
            <Pressable style={styles.actionButton} onPress={handleDirections}>
              <IconSymbol name="arrow.triangle.turn.up.right.diamond.fill" size={17} color={Colors[colorScheme].text} />
              <ThemedText style={styles.actionLabel}>Directions</ThemedText>
            </Pressable>
          </View>

          {pinSavedFeedback && (
            <ThemedText style={styles.savedFeedback}>
              Saved — find it under Profile → Saved pins, or the bookmark filter in Atlas.
            </ThemedText>
          )}

          {isMine && (
            <Pressable onPress={confirmDelete} style={styles.deleteRow}>
              <IconSymbol name="trash.fill" size={16} color="#b0392f" />
              <ThemedText style={styles.deleteLabel}>Delete pin</ThemedText>
            </Pressable>
          )}
        </ScrollView>
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
    paddingHorizontal: 20,
    marginTop: 12,
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
  },
  bannerFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  panoramaxCredit: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  panoramaxCreditLabel: {
    fontSize: 10.5,
    fontWeight: '600',
  },
  panoramax360Badge: {
    position: 'absolute',
    right: 8,
    top: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  panoramax360BadgeLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  pinTitle: {
    fontSize: 22,
    marginBottom: 4,
  },
  subMeta: {
    opacity: 0.6,
    fontSize: 13.5,
    marginBottom: 16,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
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
  actionLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  savedFeedback: {
    fontSize: 12.5,
    color: Brand,
    lineHeight: 17,
    marginTop: -10,
    marginBottom: 20,
  },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  deleteLabel: {
    color: '#b0392f',
    fontSize: 14.5,
  },
});
