import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { createListing, getMediaUrl, getMyVendor, getVendor, updateListing, uploadFile } from '@/lib/api/hubService';
import { ListingPriceType, MarketplaceVendor } from '@/lib/api/types';
import { LISTING_CONDITIONS, MARKETPLACE_CATEGORY_ORDER, MarketplaceCategory, PRICE_TYPE_META, PRICE_TYPE_ORDER, categoryMeta } from '@/lib/marketplace/categories';
import { useSession } from '@/lib/session/session-context';

type GateState = 'checking' | 'needs-vendor' | 'ready';

export default function ListingEditorScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const { id, from } = useLocalSearchParams<{ id?: string; from?: string }>();
  const isEdit = !!id;
  // Set only when this screen was reached via app/modal.tsx's launcher (its
  // "Sell or give something" row) — see handleSave: a fresh listing created
  // from there skips back past both this editor and the launcher sheet,
  // landing straight on the new listing's detail. Reached any other way
  // (Marketplace's own header "+"), Cancel/Post behave exactly as before.
  const fromComposeLauncher = from === 'compose';

  const [gate, setGate] = useState<GateState>('checking');
  const [vendor, setVendor] = useState<MarketplaceVendor | null>(null);
  const [loadingListing, setLoadingListing] = useState(isEdit);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<MarketplaceCategory>('Goods');
  const [priceType, setPriceType] = useState<ListingPriceType>('fixed');
  const [price, setPrice] = useState('');
  const [condition, setCondition] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageFileName, setImageFileName] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isService = category === 'Services' || category === 'Events';
  const showPrice = priceType !== 'free' && priceType !== 'contact';

  // Re-checked every time this screen gains focus, not just on mount — so
  // returning from vendor-editor.tsx (either "Create vendor page" from the
  // gate below, or an existing vendor's edit) immediately reflects the
  // change without a remount. Same convention as every other screen in this
  // app that can be invalidated by a screen pushed on top of it.
  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      let cancelled = false;
      getMyVendor(session.hub.tunnelUrl, session.token)
        .then((v) => {
          if (cancelled) return;
          if (!v) {
            setGate('needs-vendor');
            return;
          }
          setVendor(v);
          setGate('ready');
          if (isEdit && id) {
            setLoadingListing(true);
            getVendor(session.hub.tunnelUrl, session.token, v.id)
              .then(({ listings }) => {
                if (cancelled) return;
                const found = listings.find((l) => l.id === id);
                if (!found) {
                  setError('Listing not found.');
                  return;
                }
                setTitle(found.title);
                setDescription(found.description ?? '');
                setCategory((found.category as MarketplaceCategory) ?? 'Goods');
                setPriceType(found.price_type);
                setPrice(found.price != null ? String(found.price) : '');
                // found.condition is stored lowercase-hyphenated (e.g.
                // "like-new") — recover the exact LISTING_CONDITIONS label
                // so the matching chip highlights as selected, not just a
                // similar-looking lowercase string that fails the === check.
                setCondition(LISTING_CONDITIONS.find((c) => c.toLowerCase().replace(' ', '-') === found.condition) ?? '');
                if (found.image_file_name) {
                  setImageFileName(found.image_file_name);
                  getMediaUrl(session.hub.tunnelUrl, session.token, found.image_file_name)
                    .then(setImageUri)
                    .catch(() => {});
                }
              })
              .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to load this listing.'))
              .finally(() => !cancelled && setLoadingListing(false));
          }
        })
        .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to check your vendor page.'));
      return () => {
        cancelled = true;
      };
    }, [session, isEdit, id])
  );

  async function uploadPicked(asset: ImagePicker.ImagePickerAsset) {
    if (!session) return;
    setUploadingImage(true);
    setError(null);
    setImageUri(asset.uri);
    try {
      const uploaded = await uploadFile(session.hub.tunnelUrl, session.token, {
        uri: asset.uri,
        name: asset.fileName ?? `listing-photo-${Date.now()}.jpg`,
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
    setSaving(true);
    setError(null);
    try {
      const data = {
        title: title.trim(),
        description: description.trim() || undefined,
        category,
        price_type: priceType,
        price: showPrice && price ? parseFloat(price) : null,
        condition: !isService && condition ? condition.toLowerCase().replace(' ', '-') : undefined,
        image_file_name: imageFileName,
      };
      if (isEdit && id) {
        await updateListing(session.hub.tunnelUrl, session.token, id, data);
      } else {
        const created = await createListing(session.hub.tunnelUrl, session.token, data);
        if (fromComposeLauncher) {
          // Pop both this editor and app/modal.tsx's launcher in one go,
          // then land on the listing just created — the launcher is a
          // one-shot jumping-off point, not a screen that should still be
          // sitting in the back stack under the result.
          router.dismiss(2);
          router.push({ pathname: '/marketplace/[id]', params: { id: created.id } });
          return;
        }
      }
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that listing.");
      setSaving(false);
    }
  }

  if (!session) return null;

  return (
    <ThemedView style={styles.flex}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Cancel" accessibilityRole="button">
          <ThemedText style={styles.cancel}>Cancel</ThemedText>
        </Pressable>
        <ThemedText type="defaultSemiBold" style={styles.headerTitle}>
          {isEdit ? 'Edit listing' : 'New listing'}
        </ThemedText>
        {gate === 'ready' ? (
          <Pressable
            onPress={handleSave}
            disabled={loadingListing || saving || uploadingImage || !title.trim()}
            style={[styles.saveButton, { opacity: loadingListing || saving || uploadingImage || !title.trim() ? 0.4 : 1 }]}>
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <ThemedText style={styles.saveLabel} lightColor="#fff" darkColor="#fff">Post</ThemedText>}
          </Pressable>
        ) : (
          <View style={{ width: 44 }} />
        )}
      </View>

      {gate === 'checking' && <ActivityIndicator style={styles.spinner} />}

      {gate === 'needs-vendor' && (
        <View style={styles.gateBody}>
          <IconSymbol name="storefront.fill" size={40} color={Brand} />
          <ThemedText type="defaultSemiBold" style={styles.gateTitle}>
            Create a vendor page to start selling
          </ThemedText>
          <ThemedText style={styles.gateHint}>
            Every listing on the marketplace belongs to a vendor page — even a one-off item from a neighbor. It only takes a minute to set up.
          </ThemedText>
          <Pressable onPress={() => router.push('/marketplace/vendor-editor')} style={styles.gateButton}>
            <ThemedText style={styles.gateButtonLabel} lightColor="#fff" darkColor="#fff">
              Create vendor page
            </ThemedText>
          </Pressable>
        </View>
      )}

      {gate === 'ready' &&
        (loadingListing ? (
          <ActivityIndicator style={styles.spinner} />
        ) : (
          <ScrollView
            contentContainerStyle={styles.body}
            automaticallyAdjustKeyboardInsets
            contentInsetAdjustmentBehavior="automatic">
            {error && <ThemedText style={styles.error}>{error}</ThemedText>}
            {vendor && <ThemedText style={styles.postingAs}>Posting as {vendor.name}</ThemedText>}

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

            <ThemedText style={styles.sectionLabel}>Title</ThemedText>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="What are you selling or offering?"
              placeholderTextColor={Colors[colorScheme].icon}
              maxLength={200}
              style={[styles.input, { color: Colors[colorScheme].text }]}
            />

            <ThemedText style={styles.sectionLabel}>Category</ThemedText>
            <View style={styles.chipGrid}>
              {MARKETPLACE_CATEGORY_ORDER.map((cat) => {
                const meta = categoryMeta(cat);
                const active = category === cat;
                return (
                  <Pressable key={cat} onPress={() => setCategory(cat)} style={[styles.chip, active && { backgroundColor: meta.color }]}>
                    <IconSymbol name={meta.icon} size={13} color={active ? '#fff' : Colors[colorScheme].icon} />
                    <ThemedText style={styles.chipLabel} lightColor={active ? '#fff' : undefined} darkColor={active ? '#fff' : undefined}>
                      {cat}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>

            {!isService && (
              <>
                <ThemedText style={styles.sectionLabel}>Condition</ThemedText>
                <View style={styles.chipGrid}>
                  <Pressable onPress={() => setCondition('')} style={[styles.chip, condition === '' && { backgroundColor: Brand }]}>
                    <ThemedText style={styles.chipLabel} lightColor={condition === '' ? '#fff' : undefined} darkColor={condition === '' ? '#fff' : undefined}>
                      Not applicable
                    </ThemedText>
                  </Pressable>
                  {LISTING_CONDITIONS.map((c) => {
                    const active = condition === c;
                    return (
                      <Pressable key={c} onPress={() => setCondition(c)} style={[styles.chip, active && { backgroundColor: Brand }]}>
                        <ThemedText style={styles.chipLabel} lightColor={active ? '#fff' : undefined} darkColor={active ? '#fff' : undefined}>
                          {c}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            <ThemedText style={styles.sectionLabel}>Pricing</ThemedText>
            <View style={styles.chipGrid}>
              {PRICE_TYPE_ORDER.map((pt) => {
                const meta = PRICE_TYPE_META[pt];
                const active = priceType === pt;
                return (
                  <Pressable key={pt} onPress={() => setPriceType(pt)} style={[styles.chip, active && { backgroundColor: meta.color }]}>
                    <ThemedText style={styles.chipLabel} lightColor={active ? '#fff' : undefined} darkColor={active ? '#fff' : undefined}>
                      {meta.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
            {showPrice && (
              <View style={styles.priceRow}>
                <ThemedText style={styles.priceDollar}>$</ThemedText>
                <TextInput
                  value={price}
                  onChangeText={setPrice}
                  placeholder="0.00"
                  placeholderTextColor={Colors[colorScheme].icon}
                  keyboardType="decimal-pad"
                  style={[styles.priceInput, { color: Colors[colorScheme].text }]}
                />
              </View>
            )}

            <ThemedText style={styles.sectionLabel}>Description</ThemedText>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Describe what you're offering, condition, pickup/delivery info, etc."
              placeholderTextColor={Colors[colorScheme].icon}
              multiline
              textAlignVertical="top"
              maxLength={1000}
              style={[styles.textarea, { color: Colors[colorScheme].text }]}
            />
          </ScrollView>
        ))}
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
  gateBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    gap: 12,
    marginTop: -60,
  },
  gateTitle: {
    fontSize: 17,
    textAlign: 'center',
  },
  gateHint: {
    fontSize: 13.5,
    lineHeight: 19,
    opacity: 0.6,
    textAlign: 'center',
  },
  gateButton: {
    backgroundColor: Brand,
    borderRadius: 999,
    paddingHorizontal: 22,
    paddingVertical: 13,
    marginTop: 8,
  },
  gateButtonLabel: {
    fontSize: 14.5,
    fontWeight: '600',
  },
  body: {
    paddingHorizontal: 20,
    paddingBottom: 60,
  },
  error: {
    color: '#b0392f',
    fontSize: 13,
    marginBottom: 12,
  },
  postingAs: {
    fontSize: 12.5,
    opacity: 0.55,
    marginBottom: 4,
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
  input: {
    fontSize: 16,
    backgroundColor: '#8881',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#8881',
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    backgroundColor: '#8881',
    borderRadius: 10,
    paddingHorizontal: 14,
  },
  priceDollar: {
    fontSize: 16,
    opacity: 0.5,
  },
  priceInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 12,
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
