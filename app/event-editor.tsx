import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { createPost } from '@/lib/api/hubService';
import { useSession } from '@/lib/session/session-context';

// Tomorrow, 6pm local — a plausible default rather than "right now," since
// most events aren't happening this instant.
function defaultEventDate(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(18, 0, 0, 0);
  return d;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Events are, per the real server, just a flavor of post (category:
// 'EVENT' on hub_posts, POST /api/posts) — but they get their own launcher
// row and this dedicated screen, same as Atlas pins and Marketplace
// listings, rather than being a chip bolted onto a generic composer (see
// app/modal.tsx's own comment for the reasoning behind that split).
export default function EventEditorScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const fromComposeLauncher = from === 'compose';

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [eventDate, setEventDate] = useState(defaultEventDate());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageAsset, setImageAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onChangeDate(_event: DateTimePickerEvent, selected?: Date) {
    setShowDatePicker(Platform.OS === 'ios');
    if (!selected) return;
    setEventDate((prev) => {
      const next = new Date(prev);
      next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
      return next;
    });
  }

  function onChangeTime(_event: DateTimePickerEvent, selected?: Date) {
    setShowTimePicker(Platform.OS === 'ios');
    if (!selected) return;
    setEventDate((prev) => {
      const next = new Date(prev);
      next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
      return next;
    });
  }

  async function handlePickPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setError('Photo library permission is needed to attach a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled) return;
    setImageUri(result.assets[0].uri);
    setImageAsset(result.assets[0]);
  }

  function handleRemovePhoto() {
    setImageUri(null);
    setImageAsset(null);
  }

  async function handleSave() {
    if (!session || !title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      // POST /api/posts takes the photo directly as its own multipart `media`
      // part (unlike Atlas/Marketplace, which upload via POST /api/files
      // first and reference the resulting file_name) — so the picked asset
      // is attached straight to createPost() below, not pre-uploaded.
      const created = await createPost(session.hub.tunnelUrl, session.token, {
        category: 'EVENT',
        title: title.trim(),
        body: description.trim(),
        event_date: eventDate.toISOString(),
        event_location: location.trim() || undefined,
        media: imageAsset
          ? { uri: imageAsset.uri, name: imageAsset.fileName ?? `event-photo-${Date.now()}.jpg`, type: imageAsset.mimeType ?? 'image/jpeg' }
          : null,
      });
      if (fromComposeLauncher) {
        // Pop both this editor and app/modal.tsx's launcher in one go, then
        // land on the event just created — same convention as Atlas/Marketplace.
        router.dismiss(2);
        router.push({ pathname: '/post/[id]', params: { id: created.id } });
        return;
      }
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create that event.");
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
          New event
        </ThemedText>
        <Pressable
          onPress={handleSave}
          disabled={saving || !title.trim()}
          style={[styles.saveButton, { opacity: saving || !title.trim() ? 0.4 : 1 }]}>
          {saving ? <ActivityIndicator size="small" color="#fff" /> : <ThemedText style={styles.saveLabel} lightColor="#fff" darkColor="#fff">Post</ThemedText>}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        automaticallyAdjustKeyboardInsets
        contentInsetAdjustmentBehavior="automatic">
        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        <ThemedText style={styles.sectionLabel}>Photo</ThemedText>
        {imageUri ? (
          <View style={styles.photoPreviewWrap}>
            <Image source={{ uri: imageUri }} style={styles.photoPreview} contentFit="cover" />
            <Pressable onPress={handleRemovePhoto} style={styles.photoRemoveButton} accessibilityLabel="Remove photo">
              <IconSymbol name="xmark" size={14} color="#fff" />
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={handlePickPhoto} style={styles.photoButton}>
            <IconSymbol name="photo" size={18} color={Colors[colorScheme].icon} />
            <ThemedText style={styles.photoButtonLabel}>Add a photo</ThemedText>
          </Pressable>
        )}

        <ThemedText style={styles.sectionLabel}>Title</ThemedText>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="What's the event?"
          placeholderTextColor={Colors[colorScheme].icon}
          maxLength={200}
          style={[styles.input, { color: Colors[colorScheme].text }]}
        />

        <ThemedText style={styles.sectionLabel}>Date & time</ThemedText>
        <View style={styles.dateTimeRow}>
          <Pressable
            onPress={() => setShowDatePicker(true)}
            style={[styles.dateTimeChip, { backgroundColor: colorScheme === 'dark' ? '#2c2c2e' : '#eef0f3' }]}>
            <IconSymbol name="calendar" size={15} color={colorScheme === 'dark' ? '#fff' : '#11181C'} />
            <ThemedText style={styles.dateTimeLabel} lightColor="#11181C" darkColor="#fff">
              {formatDate(eventDate)}
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={() => setShowTimePicker(true)}
            style={[styles.dateTimeChip, { backgroundColor: colorScheme === 'dark' ? '#2c2c2e' : '#eef0f3' }]}>
            <IconSymbol name="clock.fill" size={15} color={colorScheme === 'dark' ? '#fff' : '#11181C'} />
            <ThemedText style={styles.dateTimeLabel} lightColor="#11181C" darkColor="#fff">
              {formatTime(eventDate)}
            </ThemedText>
          </Pressable>
        </View>
        {/* iOS's inline day-cell text ignores textColor/themeVariant entirely —
            confirmed even against a hardcoded solid dark background, so it's not
            a theme-mismatch, it's the renderer itself (a known
            @react-native-community/datetimepicker limitation with display="inline").
            spinner is the one display mode documented to actually respect these
            props, so the date picker uses it too now, matching the time picker. */}
        {(showDatePicker || showTimePicker) && (
          <View style={styles.pickerCard}>
            {showDatePicker && (
              <DateTimePicker
                value={eventDate}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                themeVariant="dark"
                onChange={onChangeDate}
              />
            )}
            {showTimePicker && (
              <DateTimePicker
                value={eventDate}
                mode="time"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                themeVariant="dark"
                onChange={onChangeTime}
              />
            )}
          </View>
        )}
        {Platform.OS === 'ios' && (showDatePicker || showTimePicker) && (
          <Pressable
            onPress={() => {
              setShowDatePicker(false);
              setShowTimePicker(false);
            }}
            style={styles.doneButton}>
            <ThemedText style={[styles.doneLabel, { color: Brand }]}>Done</ThemedText>
          </Pressable>
        )}

        <ThemedText style={styles.sectionLabel}>Location</ThemedText>
        <TextInput
          value={location}
          onChangeText={setLocation}
          placeholder="Where's it happening? (optional)"
          placeholderTextColor={Colors[colorScheme].icon}
          style={[styles.input, { color: Colors[colorScheme].text }]}
        />

        <ThemedText style={styles.sectionLabel}>Description</ThemedText>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Add any details neighbors should know (optional)"
          placeholderTextColor={Colors[colorScheme].icon}
          multiline
          textAlignVertical="top"
          maxLength={1000}
          style={[styles.textarea, { color: Colors[colorScheme].text }]}
        />
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
    minWidth: 60,
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
  photoButton: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#8884',
    borderStyle: 'dashed',
  },
  photoButtonLabel: {
    fontSize: 13,
    fontWeight: '600',
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
  dateTimeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  dateTimeChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
  },
  dateTimeLabel: {
    fontSize: 13.5,
    fontWeight: '600',
  },
  // #1c1c1e matches iOS's own system dark grouped-background color, so the
  // picker reads as an intentional dark card rather than a mismatched patch.
  pickerCard: {
    backgroundColor: '#1c1c1e',
    borderRadius: 14,
    overflow: 'hidden',
    marginTop: 4,
  },
  doneButton: {
    alignSelf: 'flex-end',
    paddingVertical: 10,
  },
  doneLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  textarea: {
    fontSize: 15,
    lineHeight: 21,
    minHeight: 90,
    backgroundColor: '#8881',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
});
