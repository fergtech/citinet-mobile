import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { createSpace } from '@/lib/api/hubService';
import { SpaceVisibility } from '@/lib/api/types';
import { useSession } from '@/lib/session/session-context';

const VISIBILITY_OPTIONS: { id: SpaceVisibility; label: string; hint: string }[] = [
  { id: 'public', label: 'Public', hint: 'Anyone in the hub can see and join instantly.' },
  { id: 'private', label: 'Private', hint: 'Anyone can find it, but joining needs approval.' },
  { id: 'invite-only', label: 'Invite-only', hint: 'Only people you invite can join.' },
];

// slug is a required field on POST /api/spaces (server 400s without one),
// but there's no reason to expose a separate slug input for a first pass —
// derived from the name the same way most "create a thing with a URL slug"
// flows do, and the server re-cleans it anyway (lowercases, strips to
// [a-z0-9-], collapses repeats) so an imperfect client-side pass is fine.
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// No dedicated mobile create screen existed before this — reached from the
// Create tab's launcher sheet (app/modal.tsx). Same minimal-real-screen
// approach as app/initiatives/create.tsx: one form, not a multi-step wizard,
// wired to the real POST /api/spaces.
export default function CreateSpaceScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<SpaceVisibility>('public');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    if (!session || !name.trim() || saving) return;
    const slug = slugify(name);
    if (!slug) {
      setError('That name needs at least one letter or number.');
      return;
    }
    setSaving(true);
    setError(null);
    createSpace(session.hub.tunnelUrl, session.token, {
      name: name.trim(),
      slug,
      description: description.trim() || undefined,
      visibility,
    })
      .then((created) => {
        router.replace({ pathname: '/spaces/[slug]', params: { slug: created.slug } });
      })
      .catch((err) => {
        // A slug collision (409, "A space with that slug already exists")
        // is the one error worth a nudge beyond the generic message — same
        // name taken is the realistic case here, not a truly random clash.
        setError(err instanceof Error ? err.message : "Couldn't create that space.");
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
          New space
        </ThemedText>
        <Pressable
          onPress={handleSave}
          disabled={saving || !name.trim()}
          style={[styles.saveButton, { opacity: saving || !name.trim() ? 0.4 : 1 }]}>
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

        <ThemedText style={styles.sectionLabel}>Name</ThemedText>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="What's this space called?"
          placeholderTextColor={Colors[colorScheme].icon}
          maxLength={80}
          style={[styles.input, { color: Colors[colorScheme].text }]}
        />

        <ThemedText style={styles.sectionLabel}>Description</ThemedText>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="What's it for? (optional)"
          placeholderTextColor={Colors[colorScheme].icon}
          multiline
          style={[styles.textarea, { color: Colors[colorScheme].text }]}
        />

        <ThemedText style={styles.sectionLabel}>Visibility</ThemedText>
        <View style={styles.visibilityGroup}>
          {VISIBILITY_OPTIONS.map((option) => {
            const active = visibility === option.id;
            return (
              <Pressable key={option.id} onPress={() => setVisibility(option.id)} style={[styles.visibilityRow, active && styles.visibilityRowActive]}>
                <View style={[styles.radio, active && styles.radioActive]}>{active && <View style={styles.radioDot} />}</View>
                <View style={styles.visibilityText}>
                  <ThemedText type="defaultSemiBold" style={styles.visibilityLabel}>
                    {option.label}
                  </ThemedText>
                  <ThemedText style={styles.visibilityHint}>{option.hint}</ThemedText>
                </View>
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
  textarea: {
    fontSize: 15,
    lineHeight: 21,
    minHeight: 100,
    backgroundColor: '#8881',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  visibilityGroup: {
    gap: 8,
  },
  visibilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#8881',
  },
  visibilityRowActive: {
    backgroundColor: Brand + '1a',
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#8886',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: {
    borderColor: Brand,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Brand,
  },
  visibilityText: {
    flex: 1,
    gap: 2,
  },
  visibilityLabel: {
    fontSize: 14.5,
  },
  visibilityHint: {
    fontSize: 12,
    opacity: 0.6,
    lineHeight: 16,
  },
});
