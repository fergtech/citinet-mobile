import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { createInitiative, uploadInitiativeBanner } from '@/lib/api/hubService';
import { INITIATIVE_CATEGORIES, INITIATIVE_CATEGORY_ORDER, INITIATIVE_COLORS } from '@/lib/initiatives/meta';
import { useSession } from '@/lib/session/session-context';

// Only the 19 distinct named colors (INITIATIVE_COLORS has 'gray'/'grey' as
// duplicate aliases for the same hex — one chip, not two).
const COLOR_ORDER = Object.keys(INITIATIVE_COLORS).filter((c) => c !== 'grey');

// No 3-step create wizard exists anywhere in this app yet — the Spaces spec
// (app/spaces/[slug].tsx's "Start an initiative here" row) assumes one, per
// a design mock this codebase doesn't actually implement. This is a real,
// single-screen equivalent instead of a decorative multi-step mockup: same
// POST /api/initiatives the general Initiatives screen would eventually need
// anyway, just reached from one place for now. spaceId/spaceName (when
// present) prefill hub_initiative_meta.space_id via createInitiative,
// exactly the field app/spaces/[slug].tsx's own Initiatives tab filters on.
export default function CreateInitiativeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const { spaceId, spaceName } = useLocalSearchParams<{ spaceId?: string; spaceName?: string }>();

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(INITIATIVE_CATEGORY_ORDER[0]);
  const [goal, setGoal] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('purple');
  const [bannerUri, setBannerUri] = useState<string | null>(null);
  const [bannerAsset, setBannerAsset] = useState<{ uri: string; name: string; type: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePickBanner() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setError('Photo library permission is needed to add a cover image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: true,
      aspect: [3, 1],
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setBannerUri(asset.uri);
    setBannerAsset({
      uri: asset.uri,
      name: asset.fileName ?? `initiative-banner-${Date.now()}.jpg`,
      type: asset.mimeType ?? 'image/jpeg',
    });
  }

  function handleClearBanner() {
    setBannerUri(null);
    setBannerAsset(null);
  }

  function handleSave() {
    if (!session || !title.trim() || saving) return;
    setSaving(true);
    setError(null);
    createInitiative(session.hub.tunnelUrl, session.token, {
      title: title.trim(),
      category,
      goal: goal.trim() || undefined,
      description: description.trim() || undefined,
      color,
      space_id: spaceId || undefined,
    })
      .then(async (created) => {
        // Banner upload needs a real initiative id first (create-then-upload,
        // same order citinet web's NewInitiativeModal uses) — a failure here
        // is non-critical since the initiative itself already exists; the
        // detail screen's own banner control lets the creator retry.
        if (bannerAsset) {
          await uploadInitiativeBanner(session.hub.tunnelUrl, session.token, created.id, bannerAsset).catch(() => {});
        }
        router.replace({ pathname: '/initiatives/[id]', params: { id: created.id } });
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Couldn't create that initiative.");
        setSaving(false);
      });
  }

  if (!session) return null;

  return (
    <ThemedView style={styles.flex}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Cancel" accessibilityRole="button">
          <ThemedText style={styles.cancel}>Cancel</ThemedText>
        </Pressable>
        <ThemedText type="defaultSemiBold" style={styles.headerTitle}>
          New initiative
        </ThemedText>
        <Pressable
          onPress={handleSave}
          disabled={saving || !title.trim()}
          style={[styles.saveButton, { opacity: saving || !title.trim() ? 0.4 : 1 }]}>
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <ThemedText style={styles.saveLabel} lightColor="#fff" darkColor="#fff">
              Create
            </ThemedText>
          )}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} automaticallyAdjustKeyboardInsets contentInsetAdjustmentBehavior="automatic">
        {error && <ThemedText style={styles.error}>{error}</ThemedText>}
        {!!spaceName && (
          <ThemedText style={styles.spaceNote}>
            <IconSymbol name="target" size={12} color={Brand} /> Starting under {spaceName}
          </ThemedText>
        )}

        <ThemedText style={styles.sectionLabel}>Title</ThemedText>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="What's this initiative called?"
          placeholderTextColor={Colors[colorScheme].icon}
          maxLength={200}
          style={[styles.input, { color: Colors[colorScheme].text }]}
        />

        <ThemedText style={styles.sectionLabel}>Cover image</ThemedText>
        <Pressable onPress={handlePickBanner} style={styles.bannerPicker}>
          {bannerUri ? (
            <>
              <Image source={{ uri: bannerUri }} style={styles.bannerPreview} contentFit="cover" />
              <Pressable onPress={handleClearBanner} hitSlop={8} style={styles.bannerRemove} accessibilityLabel="Remove cover image">
                <IconSymbol name="xmark" size={12} color="#fff" />
              </Pressable>
            </>
          ) : (
            <View style={styles.bannerPickerEmpty}>
              <IconSymbol name="photo" size={18} color={Colors[colorScheme].icon} />
              <ThemedText style={styles.bannerPickerLabel}>Add a cover image (optional)</ThemedText>
            </View>
          )}
        </Pressable>

        <ThemedText style={styles.sectionLabel}>Category</ThemedText>
        <View style={styles.chipGrid}>
          {INITIATIVE_CATEGORY_ORDER.map((cat) => {
            const meta = INITIATIVE_CATEGORIES[cat];
            const active = category === cat;
            return (
              <Pressable key={cat} onPress={() => setCategory(cat)} style={[styles.chip, active && { backgroundColor: Brand }]}>
                <IconSymbol name={meta.icon} size={13} color={active ? '#fff' : Colors[colorScheme].icon} />
                <ThemedText style={styles.chipLabel} lightColor={active ? '#fff' : undefined} darkColor={active ? '#fff' : undefined}>
                  {meta.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>

        <ThemedText style={styles.sectionLabel}>Goal</ThemedText>
        <TextInput
          value={goal}
          onChangeText={setGoal}
          placeholder="What does success look like? (optional)"
          placeholderTextColor={Colors[colorScheme].icon}
          maxLength={300}
          style={[styles.input, { color: Colors[colorScheme].text }]}
        />

        <ThemedText style={styles.sectionLabel}>Description</ThemedText>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Add more detail (optional)"
          placeholderTextColor={Colors[colorScheme].icon}
          multiline
          style={[styles.textarea, { color: Colors[colorScheme].text }]}
        />

        <ThemedText style={styles.sectionLabel}>Color</ThemedText>
        <View style={styles.colorGrid}>
          {COLOR_ORDER.map((c) => {
            const active = color === c;
            return (
              <Pressable
                key={c}
                onPress={() => setColor(c)}
                style={[styles.colorSwatch, { backgroundColor: INITIATIVE_COLORS[c] }, active && styles.colorSwatchActive]}
                accessibilityLabel={c}>
                {active && <IconSymbol name="checkmark" size={14} color="#fff" />}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
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
    minWidth: 68,
    alignItems: 'center',
  },
  saveLabel: {
    fontSize: 14,
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
  spaceNote: {
    fontSize: 12.5,
    opacity: 0.6,
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
  input: {
    fontSize: 16,
    backgroundColor: '#8881',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  bannerPicker: {
    height: 96,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#8881',
  },
  bannerPreview: {
    width: '100%',
    height: '100%',
  },
  bannerRemove: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerPickerEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#8884',
    borderStyle: 'dashed',
    borderRadius: 16,
  },
  bannerPickerLabel: {
    fontSize: 13,
    opacity: 0.6,
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
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  colorSwatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorSwatchActive: {
    borderWidth: 2,
    borderColor: '#fff',
  },
});
