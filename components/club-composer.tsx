import { useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';

import { ActionSheet } from '@/components/action-sheet';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { createPostOrQueue } from '@/lib/api/write-queue';
import { prepareImageForUpload } from '@/lib/media/prepare-image-upload';

// Both composers below are condensed, inline-card adaptations of
// app/compose-post.tsx and app/event-editor.tsx — same fields, same
// createPostOrQueue call, same "will send once it's back" queued treatment
// — just embedded atop a Club's own Posts/Events tab (app/clubs/[slug].tsx)
// instead of living as a separate pushed screen, and every post/event
// created here carries `space_slug` (still that literal field name — see
// hubService's own ── Clubs ── note) so it lands scoped to this club rather
// than the hub-wide feed. Each starts collapsed to a single placeholder row
// (mirrors citinet web's own SpacesScreen ComposePost) and expands in place
// on tap — no navigation, so whatever's already loaded in the tab stays put.

const MIN_POLL_OPTIONS = 2;
const MAX_POLL_OPTIONS = 5;

function defaultMediaName(asset: ImagePicker.ImagePickerAsset): string {
  if (asset.fileName) return asset.fileName;
  return asset.type === 'video' ? `post-video-${Date.now()}.mp4` : `post-photo-${Date.now()}.jpg`;
}

function defaultMediaType(asset: ImagePicker.ImagePickerAsset): string {
  // `|| ` not `??` — some Android pickers return mimeType as '' (falsy but
  // not nullish), which would otherwise slip past a ?? fallback and get
  // stored server-side as a mimeType-less, unclassifiable file.
  return asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg');
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

type ComposeMode = 'post' | 'poll';

// Posts tab — typical post creation, same as compose-post.tsx's own 'post'
// mode, plus a Poll mode switch (also from compose-post.tsx) since a club's
// Posts tab is exactly where a member would want to ask the club something,
// not just share an update. No Event mode here — that's the Events tab's
// own dedicated composer below, kept separate rather than a third mode here
// since "which tab is this going to show up under" is a real, different
// question for a post vs. an event (feedPosts/eventPosts split on
// event_date, see app/clubs/[slug].tsx).
export function ClubPostComposer({
  tunnelUrl,
  token,
  clubSlug,
  onPosted,
}: {
  tunnelUrl: string;
  token: string;
  clubSlug: string;
  onPosted: () => void;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<ComposeMode>('post');
  const [text, setText] = useState('');
  const [mediaAsset, setMediaAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [showMediaSheet, setShowMediaSheet] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [options, setOptions] = useState(['', '']);
  const [closesAt, setClosesAt] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showGovernance, setShowGovernance] = useState(false);
  const [quorumPct, setQuorumPct] = useState(0);
  const [passPct, setPassPct] = useState(50);

  function reset() {
    setExpanded(false);
    setMode('post');
    setText('');
    setMediaAsset(null);
    setError(null);
    setOptions(['', '']);
    setClosesAt(null);
    setShowDatePicker(false);
    setShowTimePicker(false);
    setShowGovernance(false);
    setQuorumPct(0);
    setPassPct(50);
  }

  function switchToPoll() {
    setMode('poll');
    setError(null);
  }

  // Back to plain-post mode, not a full reset — text/media typed so far are
  // deliberately kept (same reasoning as compose-post.tsx's own switchToPost).
  function switchToPost() {
    setMode('post');
    setError(null);
    setOptions(['', '']);
    setClosesAt(null);
    setShowDatePicker(false);
    setShowTimePicker(false);
    setShowGovernance(false);
    setQuorumPct(0);
    setPassPct(50);
  }

  function updateOption(index: number, value: string) {
    setOptions((prev) => prev.map((o, i) => (i === index ? value : o)));
  }

  function addOption() {
    setOptions((prev) => (prev.length < MAX_POLL_OPTIONS ? [...prev, ''] : prev));
  }

  function removeOption(index: number) {
    setOptions((prev) => (prev.length > MIN_POLL_OPTIONS ? prev.filter((_, i) => i !== index) : prev));
  }

  function onChangeCloseDate(_event: DateTimePickerEvent, selected?: Date) {
    setShowDatePicker(Platform.OS === 'ios');
    if (!selected) return;
    setClosesAt((prev) => {
      const next = new Date(prev ?? selected);
      next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
      return next;
    });
  }

  function onChangeCloseTime(_event: DateTimePickerEvent, selected?: Date) {
    setShowTimePicker(Platform.OS === 'ios');
    if (!selected) return;
    setClosesAt((prev) => {
      const next = new Date(prev ?? selected);
      next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
      return next;
    });
  }

  function handleAddCloseDate() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(18, 0, 0, 0);
    setClosesAt(d);
    setShowDatePicker(true);
  }

  function handleClearCloseDate() {
    setClosesAt(null);
    setShowDatePicker(false);
    setShowTimePicker(false);
  }

  async function applyImagePrep(asset: ImagePicker.ImagePickerAsset): Promise<ImagePicker.ImagePickerAsset> {
    if (asset.type !== 'image') return asset;
    try {
      const prepped = await prepareImageForUpload(asset.uri, asset.width, asset.height);
      return { ...asset, uri: prepped.uri, width: prepped.width, height: prepped.height };
    } catch {
      return asset;
    }
  }

  async function handleTakeMedia() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      setError('Camera permission is needed to capture a photo or video.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images', 'videos'], quality: 0.7 });
    if (result.canceled) return;
    setMediaAsset(await applyImagePrep(result.assets[0]));
    setError(null);
  }

  async function handlePickMedia() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setError('Photo library permission is needed to attach a photo or video.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.7 });
    if (result.canceled) return;
    setMediaAsset(await applyImagePrep(result.assets[0]));
    setError(null);
  }

  const validPollOptions = options.map((o) => o.trim()).filter(Boolean);
  const canPost = !posting && (mode === 'poll' ? !!text.trim() && validPollOptions.length >= MIN_POLL_OPTIONS : !!text.trim() || !!mediaAsset);

  async function handlePost() {
    if (!canPost) return;
    setPosting(true);
    setError(null);
    try {
      const media = mediaAsset ? { uri: mediaAsset.uri, name: defaultMediaName(mediaAsset), type: defaultMediaType(mediaAsset) } : null;
      const result =
        mode === 'poll'
          ? await createPostOrQueue(tunnelUrl, token, {
              category: 'POLL',
              title: text.trim(),
              media,
              options: validPollOptions,
              closes_at: closesAt?.toISOString(),
              quorum_pct: quorumPct,
              pass_pct: passPct,
              space_slug: clubSlug,
            })
          : await createPostOrQueue(tunnelUrl, token, {
              category: 'DISCUSSION',
              body: text.trim(),
              media,
              space_slug: clubSlug,
            });
      if (result.queued) {
        Alert.alert(
          'Saved to send later',
          `You're offline or the hub is unreachable — this ${mode === 'poll' ? 'poll' : 'post'} will send automatically once it's back.`
        );
        reset();
        return;
      }
      reset();
      onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Couldn't create that ${mode === 'poll' ? 'poll' : 'post'}.`);
    } finally {
      setPosting(false);
    }
  }

  if (!expanded) {
    return (
      <Pressable onPress={() => setExpanded(true)} style={styles.placeholder}>
        <View style={styles.placeholderIcon}>
          <IconSymbol name="pencil" size={14} color={Brand} />
        </View>
        <ThemedText style={styles.placeholderLabel}>Share something with this club…</ThemedText>
      </Pressable>
    );
  }

  return (
    <View style={styles.card}>
      {mode === 'poll' && (
        <View style={styles.modeBar}>
          <View style={styles.modeIcon}>
            <IconSymbol name="list.bullet" size={13} color={Brand} />
          </View>
          <ThemedText style={styles.modeLabel}>Creating a poll</ThemedText>
          <Pressable onPress={switchToPost} disabled={posting} hitSlop={8} accessibilityLabel="Switch back to a plain post">
            <IconSymbol name="xmark" size={13} color={Colors[colorScheme].icon} />
          </Pressable>
        </View>
      )}

      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        editable={!posting}
        autoFocus
        placeholder={mode === 'poll' ? 'Ask your neighbors something…' : 'Share something with this club…'}
        placeholderTextColor={Colors[colorScheme].icon}
        style={[styles.textInput, { color: Colors[colorScheme].text }]}
      />

      {mode === 'poll' && (
        <>
          {options.map((opt, i) => (
            <View key={i} style={styles.optionRow}>
              <TextInput
                value={opt}
                onChangeText={(v) => updateOption(i, v)}
                editable={!posting}
                placeholder={`Option ${i + 1}`}
                placeholderTextColor={Colors[colorScheme].icon}
                maxLength={120}
                style={[styles.optionInput, { color: Colors[colorScheme].text }]}
              />
              {options.length > MIN_POLL_OPTIONS && (
                <Pressable onPress={() => removeOption(i)} hitSlop={8} style={styles.optionRemove} accessibilityLabel={`Remove option ${i + 1}`}>
                  <IconSymbol name="xmark" size={13} color={Colors[colorScheme].icon} />
                </Pressable>
              )}
            </View>
          ))}
          {options.length < MAX_POLL_OPTIONS && (
            <Pressable onPress={addOption} style={styles.addOptionRow}>
              <IconSymbol name="plus" size={13} color={Brand} />
              <ThemedText style={[styles.addOptionLabel, { color: Brand }]}>Add option</ThemedText>
            </Pressable>
          )}

          {closesAt ? (
            <>
              <View style={styles.dateTimeRow}>
                <Pressable
                  onPress={() => setShowDatePicker(true)}
                  style={[styles.dateTimeChip, { backgroundColor: colorScheme === 'dark' ? '#2c2c2e' : '#eef0f3' }]}>
                  <IconSymbol name="calendar" size={14} color={colorScheme === 'dark' ? '#fff' : '#11181C'} />
                  <ThemedText style={styles.dateTimeLabel} lightColor="#11181C" darkColor="#fff">
                    {formatDate(closesAt)}
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => setShowTimePicker(true)}
                  style={[styles.dateTimeChip, { backgroundColor: colorScheme === 'dark' ? '#2c2c2e' : '#eef0f3' }]}>
                  <IconSymbol name="clock.fill" size={14} color={colorScheme === 'dark' ? '#fff' : '#11181C'} />
                  <ThemedText style={styles.dateTimeLabel} lightColor="#11181C" darkColor="#fff">
                    {formatTime(closesAt)}
                  </ThemedText>
                </Pressable>
                <Pressable onPress={handleClearCloseDate} hitSlop={8} style={styles.dateClearButton} accessibilityLabel="Remove close date">
                  <IconSymbol name="xmark" size={13} color={Colors[colorScheme].icon} />
                </Pressable>
              </View>
              {(showDatePicker || showTimePicker) && (
                <View style={styles.pickerCard}>
                  {showDatePicker && (
                    <DateTimePicker
                      value={closesAt}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      themeVariant="dark"
                      onChange={onChangeCloseDate}
                    />
                  )}
                  {showTimePicker && (
                    <DateTimePicker
                      value={closesAt}
                      mode="time"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      themeVariant="dark"
                      onChange={onChangeCloseTime}
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
            </>
          ) : (
            <Pressable onPress={handleAddCloseDate} style={styles.addCloseDateRow}>
              <IconSymbol name="calendar" size={14} color={Colors[colorScheme].icon} />
              <ThemedText style={styles.addCloseDateLabel}>Set a close date (optional)</ThemedText>
            </Pressable>
          )}

          <Pressable onPress={() => setShowGovernance((v) => !v)} style={styles.governanceToggle}>
            <IconSymbol name={showGovernance ? 'chevron.down' : 'chevron.right'} size={12} color={Colors[colorScheme].icon} />
            <ThemedText style={styles.governanceToggleLabel}>Governance options</ThemedText>
          </Pressable>
          {showGovernance && (
            <View style={styles.governanceRow}>
              <View style={styles.governanceField}>
                <ThemedText style={styles.governanceLabel}>Quorum (%)</ThemedText>
                <TextInput
                  value={String(quorumPct)}
                  onChangeText={(v) => setQuorumPct(Math.min(100, Math.max(0, parseInt(v, 10) || 0)))}
                  keyboardType="number-pad"
                  style={[styles.governanceInput, { color: Colors[colorScheme].text }]}
                />
              </View>
              <View style={styles.governanceField}>
                <ThemedText style={styles.governanceLabel}>Pass threshold (%)</ThemedText>
                <TextInput
                  value={String(passPct)}
                  onChangeText={(v) => setPassPct(Math.min(100, Math.max(1, parseInt(v, 10) || 50)))}
                  keyboardType="number-pad"
                  style={[styles.governanceInput, { color: Colors[colorScheme].text }]}
                />
              </View>
            </View>
          )}
        </>
      )}

      {mediaAsset && (
        <View style={styles.mediaPreviewWrap}>
          {mediaAsset.type === 'video' ? (
            <View style={[styles.mediaPreview, styles.videoPreview]}>
              <IconSymbol name="video.fill" size={22} color="#fff" />
              <ThemedText style={styles.videoPreviewLabel} lightColor="#fff" darkColor="#fff">
                Video attached
              </ThemedText>
            </View>
          ) : (
            <Image source={{ uri: mediaAsset.uri }} style={styles.mediaPreview} contentFit="cover" />
          )}
          {!posting && (
            <Pressable onPress={() => setMediaAsset(null)} hitSlop={8} style={styles.removeMediaButton} accessibilityLabel="Remove media">
              <IconSymbol name="xmark" size={13} color="#fff" />
            </Pressable>
          )}
        </View>
      )}

      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      <View style={styles.actionsRow}>
        <Pressable disabled={posting} onPress={() => setShowMediaSheet(true)} style={styles.attachmentChip}>
          <IconSymbol name="camera.fill" size={14} color={Brand} />
          <ThemedText style={[styles.attachmentLabel, { color: Brand }]}>{mediaAsset ? 'Change media' : 'Media'}</ThemedText>
        </Pressable>
        {mode === 'post' && (
          <Pressable disabled={posting} onPress={switchToPoll} style={styles.attachmentChip}>
            <IconSymbol name="list.bullet" size={14} color={Brand} />
            <ThemedText style={[styles.attachmentLabel, { color: Brand }]}>Poll</ThemedText>
          </Pressable>
        )}
        <View style={styles.actionsSpacer} />
        <Pressable onPress={reset} disabled={posting} style={styles.cancelButton}>
          <ThemedText style={styles.cancelLabel}>Cancel</ThemedText>
        </Pressable>
        <Pressable onPress={handlePost} disabled={!canPost} style={[styles.postButton, { backgroundColor: Brand, opacity: canPost ? 1 : 0.4 }]}>
          {posting ? <ActivityIndicator size="small" color="#fff" /> : <ThemedText style={styles.postLabel}>Post</ThemedText>}
        </Pressable>
      </View>

      <ActionSheet
        visible={showMediaSheet}
        onClose={() => setShowMediaSheet(false)}
        options={[
          { key: 'camera', label: 'Take Photo or Video', icon: 'camera.fill', onPress: handleTakeMedia },
          { key: 'library', label: 'Choose from Library', icon: 'photo', onPress: handlePickMedia },
        ]}
      />
    </View>
  );
}

function defaultEventDate(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(18, 0, 0, 0);
  return d;
}

// Events tab — event creation only, no plain-post/poll modes here at all
// (unlike ClubPostComposer above) since anything typed here always becomes
// an EVENT-category post; same fields as app/event-editor.tsx, condensed
// into an inline card instead of a pushed screen.
export function ClubEventComposer({
  tunnelUrl,
  token,
  clubSlug,
  onPosted,
}: {
  tunnelUrl: string;
  token: string;
  clubSlug: string;
  onPosted: () => void;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [eventDate, setEventDate] = useState(defaultEventDate());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [imageAsset, setImageAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setExpanded(false);
    setTitle('');
    setDescription('');
    setLocation('');
    setEventDate(defaultEventDate());
    setShowDatePicker(false);
    setShowTimePicker(false);
    setImageAsset(null);
    setError(null);
  }

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
    setImageAsset(result.assets[0]);
    setError(null);
  }

  const canSave = !saving && !!title.trim();

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const result = await createPostOrQueue(tunnelUrl, token, {
        category: 'EVENT',
        title: title.trim(),
        body: description.trim(),
        event_date: eventDate.toISOString(),
        event_location: location.trim() || undefined,
        media: imageAsset
          ? {
              uri: imageAsset.uri,
              name: imageAsset.fileName ?? `event-photo-${Date.now()}.jpg`,
              // `|| ` not `??` — some Android pickers return mimeType as ''
              // (falsy but not nullish), which would otherwise slip past a
              // ?? fallback.
              type: imageAsset.mimeType || 'image/jpeg',
            }
          : null,
        space_slug: clubSlug,
      });
      if (result.queued) {
        Alert.alert('Saved to send later', "You're offline or the hub is unreachable — this event will post automatically once it's back.");
        reset();
        return;
      }
      reset();
      onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create that event.");
    } finally {
      setSaving(false);
    }
  }

  if (!expanded) {
    return (
      <Pressable onPress={() => setExpanded(true)} style={styles.placeholder}>
        <View style={styles.placeholderIcon}>
          <IconSymbol name="calendar" size={14} color={Brand} />
        </View>
        <ThemedText style={styles.placeholderLabel}>Add an event for this club…</ThemedText>
      </Pressable>
    );
  }

  return (
    <View style={styles.card}>
      <TextInput
        value={title}
        onChangeText={setTitle}
        editable={!saving}
        autoFocus
        placeholder="What's the event?"
        placeholderTextColor={Colors[colorScheme].icon}
        maxLength={200}
        style={[styles.textInputSingle, { color: Colors[colorScheme].text }]}
      />

      <View style={styles.dateTimeRow}>
        <Pressable
          onPress={() => setShowDatePicker(true)}
          style={[styles.dateTimeChip, { backgroundColor: colorScheme === 'dark' ? '#2c2c2e' : '#eef0f3' }]}>
          <IconSymbol name="calendar" size={14} color={colorScheme === 'dark' ? '#fff' : '#11181C'} />
          <ThemedText style={styles.dateTimeLabel} lightColor="#11181C" darkColor="#fff">
            {formatDate(eventDate)}
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={() => setShowTimePicker(true)}
          style={[styles.dateTimeChip, { backgroundColor: colorScheme === 'dark' ? '#2c2c2e' : '#eef0f3' }]}>
          <IconSymbol name="clock.fill" size={14} color={colorScheme === 'dark' ? '#fff' : '#11181C'} />
          <ThemedText style={styles.dateTimeLabel} lightColor="#11181C" darkColor="#fff">
            {formatTime(eventDate)}
          </ThemedText>
        </Pressable>
      </View>
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

      <TextInput
        value={location}
        onChangeText={setLocation}
        editable={!saving}
        placeholder="Where's it happening? (optional)"
        placeholderTextColor={Colors[colorScheme].icon}
        style={[styles.textInputSingle, { color: Colors[colorScheme].text }]}
      />

      <TextInput
        value={description}
        onChangeText={setDescription}
        editable={!saving}
        placeholder="Add any details neighbors should know (optional)"
        placeholderTextColor={Colors[colorScheme].icon}
        multiline
        maxLength={1000}
        style={[styles.textInput, { color: Colors[colorScheme].text }]}
      />

      {imageAsset && (
        <View style={styles.mediaPreviewWrap}>
          <Image source={{ uri: imageAsset.uri }} style={styles.mediaPreview} contentFit="cover" />
          {!saving && (
            <Pressable onPress={() => setImageAsset(null)} hitSlop={8} style={styles.removeMediaButton} accessibilityLabel="Remove photo">
              <IconSymbol name="xmark" size={13} color="#fff" />
            </Pressable>
          )}
        </View>
      )}

      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      <View style={styles.actionsRow}>
        <Pressable disabled={saving} onPress={handlePickPhoto} style={styles.attachmentChip}>
          <IconSymbol name="photo" size={14} color={Brand} />
          <ThemedText style={[styles.attachmentLabel, { color: Brand }]}>{imageAsset ? 'Change photo' : 'Photo'}</ThemedText>
        </Pressable>
        <View style={styles.actionsSpacer} />
        <Pressable onPress={reset} disabled={saving} style={styles.cancelButton}>
          <ThemedText style={styles.cancelLabel}>Cancel</ThemedText>
        </Pressable>
        <Pressable onPress={handleSave} disabled={!canSave} style={[styles.postButton, { backgroundColor: Brand, opacity: canSave ? 1 : 0.4 }]}>
          {saving ? <ActivityIndicator size="small" color="#fff" /> : <ThemedText style={styles.postLabel}>Post</ThemedText>}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#8881',
  },
  placeholderIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand + '1a',
  },
  placeholderLabel: {
    fontSize: 14,
    opacity: 0.7,
  },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#8884',
    padding: 14,
    gap: 10,
  },
  modeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modeIcon: {
    width: 22,
    height: 22,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand + '1a',
  },
  modeLabel: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '600',
    opacity: 0.8,
  },
  textInput: {
    fontSize: 15,
    lineHeight: 20,
    minHeight: 60,
    backgroundColor: '#8881',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
  },
  textInputSingle: {
    fontSize: 15,
    backgroundColor: '#8881',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  optionInput: {
    flex: 1,
    fontSize: 14,
    backgroundColor: '#8881',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  optionRemove: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8881',
  },
  addOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  addOptionLabel: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  dateTimeRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  dateTimeChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 10,
  },
  dateTimeLabel: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  dateClearButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8881',
  },
  addCloseDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#8884',
    borderStyle: 'dashed',
  },
  addCloseDateLabel: {
    fontSize: 12.5,
    fontWeight: '600',
    opacity: 0.8,
  },
  pickerCard: {
    backgroundColor: '#1c1c1e',
    borderRadius: 14,
    overflow: 'hidden',
  },
  doneButton: {
    alignSelf: 'flex-end',
  },
  doneLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  governanceToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  governanceToggleLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.7,
  },
  governanceRow: {
    flexDirection: 'row',
    gap: 12,
  },
  governanceField: {
    flex: 1,
  },
  governanceLabel: {
    fontSize: 11,
    fontWeight: '600',
    opacity: 0.6,
    marginBottom: 4,
  },
  governanceInput: {
    fontSize: 14,
    backgroundColor: '#8881',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  mediaPreviewWrap: {
    position: 'relative',
  },
  mediaPreview: {
    width: '100%',
    height: 150,
    borderRadius: 10,
  },
  videoPreview: {
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  videoPreviewLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  removeMediaButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  error: {
    color: '#b0392f',
    fontSize: 12.5,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionsSpacer: {
    flex: 1,
  },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#8884',
  },
  attachmentLabel: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  cancelButton: {
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  cancelLabel: {
    fontSize: 13.5,
    opacity: 0.7,
  },
  postButton: {
    minWidth: 56,
    alignItems: 'center',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  postLabel: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#fff',
  },
});
