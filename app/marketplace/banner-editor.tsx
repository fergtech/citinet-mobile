import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';

import { HubMedia } from '@/components/hub-media';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getMarketplaceBannerConfig, updateMarketplaceBannerConfig, uploadFile } from '@/lib/api/hubService';
import { useSession } from '@/lib/session/session-context';

const POSITION_STEP = 10;

// Admin-only (session.isAdmin, same gate the marketplace browse screen uses
// to even show the "Edit banner" affordance) — real server also enforces
// this itself (PATCH /api/marketplace-config 403s for non-admins).
// Reposition is a stepper rather than a drag gesture: citinet web lets you
// drag the preview to set object-position, but that needs a pointer-drag
// rig this app doesn't have a template for yet (see ZoomableImage for the
// closest thing, built for pinch/pan, not a single vertical axis) — a
// stepper is a smaller, honest way to make the same field genuinely
// adjustable without inventing new gesture code for a rarely-touched admin
// screen.
export default function BannerEditorScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();

  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [position, setPosition] = useState(50);
  const [imageFileName, setImageFileName] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    getMarketplaceBannerConfig(session.hub.tunnelUrl, session.token)
      .then((config) => {
        if (cancelled) return;
        setTitle(config.marketplace_banner_title ?? '');
        setSubtitle(config.marketplace_banner_subtitle ?? '');
        setPosition(Number(config.marketplace_banner_position) || 50);
        setImageFileName(config.marketplace_banner_image ?? null);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to load the banner.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [session]);

  async function handlePickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setError('Photo library permission is needed to set a cover image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled || !session) return;
    const asset = result.assets[0];
    setUploadingImage(true);
    setError(null);
    try {
      const uploaded = await uploadFile(session.hub.tunnelUrl, session.token, {
        uri: asset.uri,
        name: asset.fileName ?? `marketplace-banner-${Date.now()}.jpg`,
        type: asset.mimeType ?? 'image/jpeg',
      });
      setImageFileName(uploaded.file_name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't upload that image.");
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleSave() {
    if (!session) return;
    setSaving(true);
    setError(null);
    try {
      await updateMarketplaceBannerConfig(session.hub.tunnelUrl, session.token, {
        marketplace_banner_title: title.trim(),
        marketplace_banner_subtitle: subtitle.trim(),
        marketplace_banner_position: String(Math.round(position)),
        marketplace_banner_image: imageFileName ?? '',
      });
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the banner.");
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
          Edit banner
        </ThemedText>
        <Pressable onPress={handleSave} disabled={loading || saving || uploadingImage} style={[styles.saveButton, { opacity: loading || saving || uploadingImage ? 0.4 : 1 }]}>
          {saving ? <ActivityIndicator size="small" color="#fff" /> : <ThemedText style={styles.saveLabel} lightColor="#fff" darkColor="#fff">Save</ThemedText>}
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={styles.spinner} />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          <ThemedText style={styles.sectionLabel}>Live preview</ThemedText>
          <View style={styles.preview}>
            {imageFileName ? (
              <HubMedia
                fileName={imageFileName}
                tunnelUrl={session.hub.tunnelUrl}
                token={session.token}
                style={styles.previewImage}
                contentPosition={{ top: `${position}%` }}
              />
            ) : (
              <View style={styles.previewFallback}>
                <IconSymbol name="storefront.fill" size={40} color="rgba(255,255,255,0.14)" />
              </View>
            )}
            <View style={styles.previewScrim} />
            <View style={styles.previewText}>
              <ThemedText style={styles.previewEyebrow}>Local Exchange</ThemedText>
              <ThemedText type="defaultSemiBold" style={styles.previewHeading} lightColor="#fff" darkColor="#fff">
                {title || 'Everything local, right here'}
              </ThemedText>
              {!!subtitle && (
                <ThemedText style={styles.previewSubtitle} lightColor="#e2e8f0" darkColor="#e2e8f0">
                  {subtitle}
                </ThemedText>
              )}
            </View>
            {uploadingImage && (
              <View style={styles.previewUploadingOverlay}>
                <ActivityIndicator color="#fff" />
              </View>
            )}
          </View>

          <View style={styles.previewActions}>
            <Pressable onPress={handlePickImage} disabled={uploadingImage} style={styles.secondaryButton}>
              <IconSymbol name="photo" size={15} color={Colors[colorScheme].text} />
              <ThemedText style={styles.secondaryButtonLabel}>{imageFileName ? 'Replace image' : 'Upload image'}</ThemedText>
            </Pressable>
            {!!imageFileName && (
              <Pressable onPress={() => setImageFileName(null)} disabled={uploadingImage} style={styles.secondaryButton}>
                <IconSymbol name="trash.fill" size={15} color="#b0392f" />
                <ThemedText style={[styles.secondaryButtonLabel, { color: '#b0392f' }]}>Remove</ThemedText>
              </Pressable>
            )}
          </View>

          {!!imageFileName && (
            <>
              <ThemedText style={styles.sectionLabel}>Vertical position</ThemedText>
              <View style={styles.positionRow}>
                <Pressable
                  onPress={() => setPosition((p) => Math.max(0, p - POSITION_STEP))}
                  disabled={position <= 0}
                  style={[styles.stepButton, { opacity: position <= 0 ? 0.3 : 1 }]}>
                  <IconSymbol name="chevron.left" size={16} color={Colors[colorScheme].text} />
                </Pressable>
                <ThemedText style={styles.positionValue}>{position}%</ThemedText>
                <Pressable
                  onPress={() => setPosition((p) => Math.min(100, p + POSITION_STEP))}
                  disabled={position >= 100}
                  style={[styles.stepButton, { opacity: position >= 100 ? 0.3 : 1 }]}>
                  <IconSymbol name="chevron.right" size={16} color={Colors[colorScheme].text} />
                </Pressable>
              </View>
            </>
          )}

          <ThemedText style={styles.sectionLabel}>Heading</ThemedText>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Everything local, right here"
            placeholderTextColor={Colors[colorScheme].icon}
            maxLength={80}
            style={[styles.input, { color: Colors[colorScheme].text }]}
          />

          <ThemedText style={styles.sectionLabel}>Subtext</ThemedText>
          <TextInput
            value={subtitle}
            onChangeText={setSubtitle}
            placeholder="Buy, sell & trade with your neighbors"
            placeholderTextColor={Colors[colorScheme].icon}
            maxLength={100}
            style={[styles.input, { color: Colors[colorScheme].text }]}
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
  body: {
    paddingHorizontal: 20,
    paddingBottom: 60,
  },
  error: {
    color: '#b0392f',
    fontSize: 13,
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 8,
  },
  preview: {
    height: 130,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#18181b',
  },
  previewImage: {
    ...StyleSheet.absoluteFillObject,
    aspectRatio: undefined,
    borderRadius: 0,
  },
  previewFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 20,
  },
  previewScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(9,9,11,0.45)',
  },
  previewText: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  previewEyebrow: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#34d399',
    marginBottom: 4,
  },
  previewHeading: {
    fontSize: 17,
    lineHeight: 22,
  },
  previewSubtitle: {
    fontSize: 13,
    marginTop: 3,
  },
  previewUploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#8881',
  },
  secondaryButtonLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  positionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  stepButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8881',
  },
  positionValue: {
    fontSize: 15,
    fontWeight: '600',
    minWidth: 44,
    textAlign: 'center',
  },
  input: {
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#8884',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
});
