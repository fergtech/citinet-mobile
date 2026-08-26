import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';

import { LeafletMap } from '@/components/atlas/leaflet-map';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { createAtlasPin, getMediaUrl, listAtlasPins, updateAtlasPin, uploadFile } from '@/lib/api/hubService';
import { AtlasPinCategory } from '@/lib/api/types';
import { ATLAS_CATEGORIES, ATLAS_CATEGORY_ORDER } from '@/lib/atlas/categories';
import { useHubCenter } from '@/lib/atlas/hub-center';
import { useSession } from '@/lib/session/session-context';

const DEFAULT_CENTER: [number, number] = [39.8283, -98.5795];

export default function PinEditorScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const hubCenter = useHubCenter();
  const {
    id,
    from,
    lat: latParam,
    lng: lngParam,
    title: titleParam,
    category: categoryParam,
  } = useLocalSearchParams<{ id?: string; from?: string; lat?: string; lng?: string; title?: string; category?: string }>();
  const isEdit = !!id;
  // Set only when this screen was reached via app/modal.tsx's launcher (its
  // "Drop a pin" row) — see handleSave: a fresh pin created from there skips
  // back past both this editor and the launcher sheet, landing straight on
  // the new pin's detail. Reached any other way (Atlas's own header "+"),
  // Cancel/Save behave exactly as before.
  const fromComposeLauncher = from === 'compose';
  // lat/lng/title/category arrive from app/atlas/location.tsx's "Add this to
  // the Atlas" CTA (a location that resolved from an event but has no real
  // pin yet) — pre-fills a real create flow instead of leaving the user to
  // re-enter coordinates they already looked at. Harmless no-ops in edit
  // mode, since that branch's own load effect below overwrites all of these
  // from the real pin regardless.
  const initialCoords: [number, number] | null =
    latParam && lngParam ? [parseFloat(latParam), parseFloat(lngParam)] : null;
  const initialCategory: AtlasPinCategory = ATLAS_CATEGORY_ORDER.includes(categoryParam as AtlasPinCategory)
    ? (categoryParam as AtlasPinCategory)
    : 'poi';

  const [title, setTitle] = useState(titleParam ?? '');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<AtlasPinCategory>(initialCategory);
  const [coords, setCoords] = useState<[number, number] | null>(initialCoords);
  const [locating, setLocating] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // imageUri is whatever's shown as the preview (a local file:// uri right
  // after picking, or a resolved token-gated download URL for an existing
  // pin's photo in edit mode) — imageFileName is the actual value sent to
  // the server, decoupled so the preview doesn't depend on re-resolving a URL.
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageFileName, setImageFileName] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  // Editing: load the existing pin (no single-pin GET route — same
  // list-and-find approach as app/atlas/[id].tsx). Coordinates aren't
  // editable (the server's PATCH route doesn't accept them either).
  useEffect(() => {
    if (!isEdit || !session || !id) return;
    let cancelled = false;
    listAtlasPins(session.hub.tunnelUrl, session.token)
      .then((pins) => {
        if (cancelled) return;
        const found = pins.find((p) => p.id === id);
        if (!found) {
          setError('Pin not found.');
          return;
        }
        setTitle(found.title);
        setDescription(found.description ?? '');
        setCategory(found.category);
        setCoords([found.latitude, found.longitude]);
        if (found.image_file_name) {
          setImageFileName(found.image_file_name);
          getMediaUrl(session.hub.tunnelUrl, session.token, found.image_file_name)
            .then(setImageUri)
            .catch(() => {});
        }
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to load this pin.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [isEdit, session, id]);

  async function useCurrentLocation() {
    setLocating(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission is needed to drop a pin at your current position.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoords([pos.coords.latitude, pos.coords.longitude]);
    } catch {
      setError("Couldn't get your current location. Try again, or tap the map to place it manually.");
    } finally {
      setLocating(false);
    }
  }

  async function uploadPicked(asset: ImagePicker.ImagePickerAsset) {
    if (!session) return;
    setUploadingImage(true);
    setError(null);
    setImageUri(asset.uri);
    try {
      const uploaded = await uploadFile(session.hub.tunnelUrl, session.token, {
        uri: asset.uri,
        name: asset.fileName ?? `pin-photo-${Date.now()}.jpg`,
        type: asset.mimeType ?? 'image/jpeg',
      });
      setImageFileName(uploaded.file_name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't upload that photo.");
      setImageUri(null);
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleTakePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      setError('Camera permission is needed to take a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!result.canceled) await uploadPicked(result.assets[0]);
  }

  async function handleChooseFromLibrary() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setError('Photo library permission is needed to attach a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled) await uploadPicked(result.assets[0]);
  }

  function handleRemoveImage() {
    setImageUri(null);
    setImageFileName(null);
  }

  async function handleSave() {
    if (!session || !title.trim()) return;
    if (!isEdit && !coords) {
      setError('Set a location for this pin first.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (isEdit && id) {
        await updateAtlasPin(session.hub.tunnelUrl, session.token, id, {
          title: title.trim(),
          description: description.trim() || undefined,
          category,
          image_file_name: imageFileName,
        });
      } else if (coords) {
        const created = await createAtlasPin(session.hub.tunnelUrl, session.token, {
          latitude: coords[0],
          longitude: coords[1],
          image_file_name: imageFileName,
          title: title.trim(),
          description: description.trim() || undefined,
          category,
        });
        if (fromComposeLauncher) {
          // Pop both this editor and app/modal.tsx's launcher in one go,
          // then land on the pin just created — the launcher is a
          // one-shot jumping-off point, not a screen that should still be
          // sitting in the back stack under the result.
          router.dismiss(2);
          router.push({ pathname: '/atlas/[id]', params: { id: created.id } });
          return;
        }
      }
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save this pin.");
      setSaving(false);
    }
  }

  if (!session) return null;

  const mapCenter = coords ?? hubCenter ?? DEFAULT_CENTER;

  return (
    <ThemedView style={styles.flex}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Cancel" accessibilityRole="button">
          <ThemedText style={styles.cancel}>Cancel</ThemedText>
        </Pressable>
        <ThemedText type="defaultSemiBold" style={styles.headerTitle}>
          {isEdit ? 'Edit pin' : 'New pin'}
        </ThemedText>
        <Pressable
          onPress={handleSave}
          disabled={loading || saving || uploadingImage || !title.trim() || (!isEdit && !coords)}
          style={[
            styles.saveButton,
            { opacity: loading || saving || uploadingImage || !title.trim() || (!isEdit && !coords) ? 0.4 : 1 },
          ]}>
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <ThemedText style={styles.saveLabel} lightColor="#fff" darkColor="#fff">
              Save
            </ThemedText>
          )}
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={styles.spinner} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.body}
          automaticallyAdjustKeyboardInsets
          contentInsetAdjustmentBehavior="automatic">
          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          <ThemedText style={styles.sectionLabel}>Photo</ThemedText>
          {imageUri ? (
            <View style={styles.photoPreviewWrap}>
              <Image source={{ uri: imageUri }} style={styles.photoPreview} contentFit="cover" />
              {uploadingImage && (
                <View style={styles.photoUploadingOverlay}>
                  <ActivityIndicator color="#fff" />
                </View>
              )}
              <Pressable onPress={handleRemoveImage} disabled={uploadingImage} style={styles.photoRemoveButton} accessibilityLabel="Remove photo">
                <IconSymbol name="xmark" size={14} color="#fff" />
              </Pressable>
            </View>
          ) : (
            <View style={styles.photoButtonsRow}>
              <Pressable onPress={handleTakePhoto} style={styles.photoButton}>
                <IconSymbol name="camera.fill" size={18} color={Colors[colorScheme].icon} />
                <ThemedText style={styles.photoButtonLabel}>Take Photo</ThemedText>
              </Pressable>
              <Pressable onPress={handleChooseFromLibrary} style={styles.photoButton}>
                <IconSymbol name="photo" size={18} color={Colors[colorScheme].icon} />
                <ThemedText style={styles.photoButtonLabel}>Choose from Library</ThemedText>
              </Pressable>
            </View>
          )}
          <ThemedText style={styles.locationHint}>
            No photo? Pin Detail shows a close-up map of this location instead.
          </ThemedText>

          {!isEdit && (
            <>
              <ThemedText style={styles.sectionLabel}>Location</ThemedText>
              <LeafletMap
                pins={[]}
                center={mapCenter}
                zoom={coords ? 16 : hubCenter ? 13 : 4}
                placingMode
                pendingMarker={coords}
                onMapPress={(lat, lng) => setCoords([lat, lng])}
                style={styles.locationMap}
              />
              <Pressable onPress={useCurrentLocation} disabled={locating} style={styles.locateButton}>
                {locating ? (
                  <ActivityIndicator size="small" color={Brand} />
                ) : (
                  <IconSymbol name="location.fill" size={16} color={Brand} />
                )}
                <ThemedText style={[styles.locateLabel, { color: Brand }]}>
                  {coords ? 'Update to my current location' : 'Use my current location'}
                </ThemedText>
              </Pressable>
              <ThemedText style={styles.locationHint}>
                {coords ? 'Tap the map to fine-tune, or use the button above.' : 'Tap the map or use the button above to set where this pin drops.'}
              </ThemedText>
            </>
          )}

          <ThemedText style={styles.sectionLabel}>Title</ThemedText>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="What's here?"
            placeholderTextColor={Colors[colorScheme].icon}
            style={[styles.input, { color: Colors[colorScheme].text }]}
          />

          <ThemedText style={styles.sectionLabel}>Category</ThemedText>
          <View style={styles.categoryGrid}>
            {ATLAS_CATEGORY_ORDER.map((cat) => {
              const meta = ATLAS_CATEGORIES[cat];
              const active = category === cat;
              return (
                <Pressable key={cat} onPress={() => setCategory(cat)} style={[styles.categoryChip, active && { backgroundColor: meta.color }]}>
                  <IconSymbol name={meta.icon} size={13} color={active ? '#fff' : Colors[colorScheme].icon} />
                  <ThemedText style={styles.categoryLabel} lightColor={active ? '#fff' : undefined} darkColor={active ? '#fff' : undefined}>
                    {meta.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>

          <ThemedText style={styles.sectionLabel}>Description</ThemedText>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Add a few details (optional)"
            placeholderTextColor={Colors[colorScheme].icon}
            multiline
            textAlignVertical="top"
            style={[styles.textarea, { color: Colors[colorScheme].text }]}
          />
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
    gap: 10,
  },
  cancel: {
    fontSize: 15,
    opacity: 0.7,
  },
  headerTitle: {
    fontSize: 16,
  },
  saveButton: {
    backgroundColor: Brand,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minWidth: 60,
    alignItems: 'center',
  },
  saveLabel: {
    fontSize: 14,
    fontWeight: '600',
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
    paddingBottom: 60,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 8,
  },
  photoButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  photoButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#8884',
    borderStyle: 'dashed',
  },
  photoButtonLabel: {
    fontSize: 12.5,
    fontWeight: '600',
    textAlign: 'center',
  },
  photoPreviewWrap: {
    height: 160,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#8881',
  },
  photoPreview: {
    flex: 1,
  },
  photoUploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoRemoveButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationMap: {
    height: 160,
    borderRadius: 12,
    overflow: 'hidden',
  },
  locateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  locateLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  locationHint: {
    fontSize: 12,
    opacity: 0.5,
    marginTop: 6,
    lineHeight: 16,
  },
  input: {
    fontSize: 16,
    backgroundColor: '#8881',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#8881',
  },
  categoryLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  textarea: {
    fontSize: 15,
    lineHeight: 21,
    minHeight: 100,
    backgroundColor: '#8881',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
});
